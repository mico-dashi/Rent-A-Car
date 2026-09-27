// Local Supabase-compatible gateway: /rest/v1 -> PostgREST, /auth/v1 -> GoTrue,
// /storage/v1 -> storage emulator that enforces storage.objects RLS by running
// each request as the caller's role with their JWT claims (like Supabase Storage).
// DEVELOPMENT/TEST ONLY.
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../packages/testing/package.json", import.meta.url));
const pg = require("pg");

const { JWT_SECRET, DB_URL, GATEWAY_PORT = "54321", PGRST_PORT = "54331", AUTH_PORT = "54332", DATA_DIR } = process.env;
const pool = new pg.Pool({ connectionString: DB_URL, max: 10 });

function verifyJwt(token) {
  const [h, p, s] = (token ?? "").split(".");
  if (!h || !p || !s) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  return claims;
}
function sign(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b(payload);
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-upsert, accept-profile, content-profile, prefer, range, cache-control, x-supabase-api-version, x-region",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "access-control-expose-headers": "content-range, content-length",
};

function proxy(req, res, port, path) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const p = http.request({ host: "127.0.0.1", port: Number(port), path, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors });
    r.pipe(res);
  });
  p.on("error", () => { res.writeHead(502, cors); res.end(); });
  req.pipe(p);
}

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
const filePath = (bucket, name) => join(DATA_DIR, "storage", bucket, name);

/** Run fn as the JWT's role so storage.objects RLS policies decide. */
async function asRole(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const role = claims.role === "service_role" ? "service_role" : claims.role === "authenticated" ? "authenticated" : "anon";
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`set local role ${role}`);
    const r = await fn(client);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function storage(req, res, url) {
  const parts = url.pathname.replace(/^\/storage\/v1\//, "").split("/").map(decodeURIComponent);
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "") || req.headers.apikey;
  // Public objects
  if (parts[0] === "object" && parts[1] === "public" && req.method === "GET") {
    const [bucket, ...rest] = parts.slice(2);
    const { rows } = await pool.query("select public from storage.buckets where id = $1", [bucket]);
    const f = filePath(bucket, rest.join("/"));
    if (!rows[0]?.public || !existsSync(f)) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": ctype(f), ...cors });
    return res.end(readFileSync(f));
  }
  // Signed download
  if (parts[0] === "object" && parts[1] === "sign" && req.method === "GET") {
    const claims = verifyJwt(url.searchParams.get("token"));
    const [bucket, ...rest] = parts.slice(2);
    const name = rest.join("/");
    if (!claims || claims.url !== `${bucket}/${name}`) return json(res, 400, { error: "invalid signature" });
    const f = filePath(bucket, name);
    if (!existsSync(f)) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": ctype(f), ...cors });
    return res.end(readFileSync(f));
  }
  const claims = verifyJwt(token);
  if (!claims) return json(res, 401, { statusCode: "401", error: "Unauthorized", message: "invalid JWT" });

  if (parts[0] === "object" && parts[1] === "sign" && req.method === "POST") {
    const [bucket, ...rest] = parts.slice(2);
    const name = rest.join("/");
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const found = await asRole(claims, (c) => c.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name]));
    if (!found.rowCount) return json(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    const t = sign({ url: `${bucket}/${name}`, exp: Math.floor(Date.now() / 1000) + Number(body.expiresIn ?? 60) });
    return json(res, 200, { signedURL: `/object/sign/${bucket}/${name}?token=${t}` });
  }
  if (parts[0] === "object" && (req.method === "POST" || req.method === "PUT")) {
    const [bucket, ...rest] = parts.slice(1);
    const name = rest.join("/");
    const bytes = await readBody(req);
    try {
      await asRole(claims, async (c) => {
        const upsert = req.headers["x-upsert"] === "true";
        if (upsert) {
          const u = await c.query("update storage.objects set owner = owner where bucket_id = $1 and name = $2", [bucket, name]);
          if (u.rowCount) return;
        }
        await c.query("insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)", [bucket, name, claims.sub ?? null]);
      });
    } catch (e) {
      return json(res, 400, { statusCode: "403", error: "Unauthorized", message: String(e.message) });
    }
    mkdirSync(dirname(filePath(bucket, name)), { recursive: true });
    writeFileSync(filePath(bucket, name), bytes);
    return json(res, 200, { Key: `${bucket}/${name}`, Id: name });
  }
  if (parts[0] === "object" && (req.method === "GET" || req.method === "HEAD")) {
    const [maybeAuth, ...afterAuth] = parts.slice(1);
    const segs = maybeAuth === "authenticated" ? afterAuth : parts.slice(1);
    const [bucket, ...rest] = segs;
    const name = rest.join("/");
    const found = await asRole(claims, (c) => c.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name]));
    const f = filePath(bucket, name);
    if (!found.rowCount || !existsSync(f)) return json(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    res.writeHead(200, { "content-type": ctype(f), ...cors });
    return res.end(readFileSync(f));
  }
  return json(res, 404, { error: "unsupported storage route in local emulator" });
}

function ctype(f) {
  if (f.endsWith(".pdf")) return "application/pdf";
  if (f.endsWith(".png")) return "image/png";
  if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
  if (f.endsWith(".webp")) return "image/webp";
  if (f.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { ...cors, "access-control-allow-headers": req.headers["access-control-request-headers"] ?? cors["access-control-allow-headers"] }); return res.end(); }
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/rest/v1")) return proxy(req, res, PGRST_PORT, req.url.slice(8) || "/");
    if (url.pathname.startsWith("/auth/v1")) return proxy(req, res, AUTH_PORT, req.url.slice(8) || "/");
    if (url.pathname.startsWith("/storage/v1")) return await storage(req, res, url);
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
}).listen(Number(GATEWAY_PORT), "127.0.0.1", () => console.log(`gateway on http://127.0.0.1:${GATEWAY_PORT}`));
