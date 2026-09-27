#!/usr/bin/env node
// Local full stack without Docker: Postgres (you provide) + Supabase Auth (GoTrue)
// + PostgREST + storage emulator behind a Supabase-shaped gateway.
// Usage: DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres node tools/local-stack/stack.mjs [--fresh]
import { spawn, execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const bin = join(here, ".bin");
const dataDir = join(here, ".data");
const admin = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/postgres";
const dbName = process.env.STACK_DB ?? "rental_stack";
const dbUrl = `${admin.replace(/\/[^/]*$/, "")}/${dbName}`;
const secret = process.env.JWT_SECRET ?? "local-dev-jwt-secret-at-least-32-characters-long";
const fresh = process.argv.includes("--fresh");
const psql = (url, sql) => execFileSync("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", "-qAtc", sql], { encoding: "utf8" }).trim();
const psqlFile = (url, file) => execFileSync("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", "-q", "-o", "/dev/null", "-f", file], { stdio: ["ignore", "ignore", "pipe"] });
const u = new URL(admin);
const withUser = (user, db = dbName) => `postgres://${user}${u.password ? `:${u.password}` : ""}@${u.host}/${db}`;

function jwt(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b(payload);
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
const ANON = jwt({ role: "anon", iss: "supabase-local", exp });
const SERVICE = jwt({ role: "service_role", iss: "supabase-local", exp });

const exists = psql(admin, `select 1 from pg_database where datname = '${dbName}'`) === "1";
if (fresh || !exists) {
  console.log(`creating database ${dbName}`);
  psql(admin, `drop database if exists ${dbName} with (force)`);
  psql(admin, `create database ${dbName}`);
  const pw = u.password ? ` password '${u.password}'` : "";
  psql(admin, `do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
    if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit${pw}; end if;
    if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login createrole${pw}; end if;
  end $$; grant anon, authenticated, service_role to authenticator;`);
  psql(dbUrl, `create schema if not exists auth authorization supabase_auth_admin; create schema if not exists extensions;
    grant create on database ${dbName} to supabase_auth_admin; alter role supabase_auth_admin set search_path = auth;
    alter database ${dbName} set search_path = public, extensions;`);
  // GoTrue creates and migrates the auth schema.
  console.log("migrating auth (GoTrue)");
  execFileSync(join(bin, "auth"), ["migrate"], { env: authEnv(), cwd: bin, stdio: ["ignore", "ignore", "inherit"] });
  psql(dbUrl, "grant usage on schema auth to anon, authenticated, service_role, postgres; grant select on auth.users to postgres;");
  console.log("applying shim, migrations, seed");
  psqlFile(dbUrl, join(root, "supabase/tests/shim/supabase_shim.sql"));
  for (const f of readdirSync(join(root, "supabase/migrations")).sort()) psqlFile(dbUrl, join(root, "supabase/migrations", f));
  psqlFile(dbUrl, join(root, "supabase/seed.sql"));
  psql(dbUrl, "grant usage on schema extensions to anon, authenticated, service_role");
}

function authEnv() {
  return {
    ...process.env,
    GOTRUE_DB_DRIVER: "postgres", DATABASE_URL: `${withUser("supabase_auth_admin")}?search_path=auth`, GOTRUE_DB_NAMESPACE: "auth",
    GOTRUE_API_HOST: "127.0.0.1", PORT: "54332", API_EXTERNAL_URL: "http://127.0.0.1:54321/auth/v1",
    GOTRUE_SITE_URL: process.env.SITE_URL ?? "http://localhost:3000",
    GOTRUE_URI_ALLOW_LIST: "http://localhost:3000/**,http://localhost:3001/**,http://*.localhost:3000/**,rentalplatform://**",
    GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_EXP: "3600", GOTRUE_JWT_AUD: "authenticated", GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role", GOTRUE_DISABLE_SIGNUP: "false", GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "true", GOTRUE_SMTP_ADMIN_EMAIL: "noreply@localhost", GOTRUE_MFA_TOTP_ENROLL_ENABLED: "true", GOTRUE_MFA_TOTP_VERIFY_ENABLED: "true",
    GOTRUE_PASSWORD_MIN_LENGTH: "10", GOTRUE_LOG_LEVEL: "warn", GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000",
  };
}

mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "pgrst.conf"), [
  `db-uri = "${withUser("authenticator")}"`, `db-schemas = "public"`, `db-anon-role = "anon"`, `db-extra-search-path = "public, extensions"`,
  `jwt-secret = "${secret}"`, `server-port = 54331`, `server-host = "127.0.0.1"`,
].join("\n"));

const procs = [
  spawn(join(bin, "auth"), ["serve"], { env: authEnv(), cwd: bin, stdio: ["ignore", "inherit", "inherit"] }),
  spawn(join(bin, "postgrest"), [join(dataDir, "pgrst.conf")], { stdio: ["ignore", "ignore", "inherit"] }),
  spawn(process.execPath, [join(here, "gateway.mjs")], {
    env: { ...process.env, JWT_SECRET: secret, DB_URL: dbUrl, DATA_DIR: dataDir }, stdio: ["ignore", "inherit", "inherit"],
  }),
];
const envOut = `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE}\nEXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${ANON}\nSTACK_DATABASE_URL=${dbUrl}\n`;
writeFileSync(join(dataDir, "stack.env"), envOut);
console.log(`\nlocal stack up — env written to ${join(dataDir, "stack.env")}\n${envOut}`);
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => { console.error(`process exited (${code}); stopping stack`); stop(); });
