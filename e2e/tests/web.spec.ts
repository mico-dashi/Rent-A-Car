import { expect, test } from "@playwright/test";
import { CRON_SECRET, USERS, WEB, firstHref, localDateTime, visitClean, webApi, webSignIn } from "./helpers";

const CITY_BRANCH = "20000000-0000-4000-8000-000000000001";

test.describe("storefront", () => {
  test("public pages render for the tenant host", async ({ page }) => {
    for (const p of ["/", "/fleet", "/about", "/faq", "/contact", "/terms", "/privacy"]) await visitClean(page, `${WEB}${p}`);
  });

  test("search shows available cars and a vehicle detail with a quote", async ({ page }) => {
    const start = localDateTime(30, 10), end = localDateTime(33, 10);
    const text = await visitClean(page, `${WEB}/search?pickup=${CITY_BRANCH}&start=${start}&end=${end}`);
    expect(text).toMatch(/cars? available/);
    const href = await firstHref(page, /^\/vehicles\/[0-9a-f-]{36}/);
    expect(href).toBeTruthy();
    const detail = await visitClean(page, new URL(href!, WEB).toString());
    expect(detail).toMatch(/Specifications/);
  });

  test("unknown hosts are not served", async ({ request }) => {
    const { url, headers } = webApi("/", "unknown-tenant.localhost:3000");
    const res = await request.get(url, { headers });
    expect(res.status()).toBe(404);
  });
});

test.describe("customer account", () => {
  test("bookings list and privacy tools", async ({ page }) => {
    await webSignIn(page, USERS.customer);
    await visitClean(page, `${WEB}/account/bookings`);
    await visitClean(page, `${WEB}/account/privacy`);
    // Fetch from inside the page so the session cookie is sent.
    const res = await page.evaluate(async () => {
      const r = await fetch("/account/export");
      return { status: r.status, disposition: r.headers.get("content-disposition"), body: await r.text() };
    });
    expect(res.status).toBe(200);
    expect(res.disposition).toContain("attachment");
    expect(res.body).toContain(USERS.customer);
  });

  test("signed-out users cannot export data", async ({ request }) => {
    const { url, headers } = webApi("/account/export");
    expect((await request.get(url, { headers })).status()).toBe(401);
  });
});

test.describe("scheduler", () => {
  test("cron tick requires the secret and runs every job", async ({ request }) => {
    const { url, headers } = webApi("/api/v1/cron/tick");
    expect((await request.post(url, { headers })).status()).toBe(401);
    expect((await request.post(url, { headers: { ...headers, authorization: "Bearer wrong-secret-wrong-secret-00" } })).status()).toBe(401);
    const res = await request.post(url, { headers: { ...headers, authorization: `Bearer ${CRON_SECRET}` } });
    expect(res.status()).toBe(200);
    const { results } = (await res.json()) as { results: Record<string, { ok: boolean }> };
    expect(Object.values(results).every((r) => r.ok)).toBe(true);
  });
});

test.describe("content security policy", () => {
  test("pages carry a per-request nonce CSP without unsafe-inline scripts, and still hydrate", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|CSP/i.test(m.text())) errors.push(m.text()); });
    const first = await page.goto(`${WEB}/fleet`);
    const csp = first!.headers()["content-security-policy"] ?? "";
    const script = csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]{20,}'/);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    const nonce = /'nonce-([^']+)'/.exec(script)![1]!;
    // Next.js stamps the nonce on its scripts (attribute is hidden from the DOM, so check the property).
    const nonced = await page.locator("script[src]").evaluateAll((els, n) => els.filter((e) => (e as HTMLScriptElement).nonce === n).length, nonce);
    expect(nonced).toBeGreaterThan(0);
    const second = await page.goto(`${WEB}/fleet`);
    expect(second!.headers()["content-security-policy"]).not.toBe(csp); // fresh nonce per request
    // Hydrated: the client-side language switcher works.
    await page.getByRole("button", { name: "Shqip" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "sq");
    expect(errors).toEqual([]);
  });
});
