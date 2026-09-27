import { expect, type Page } from "@playwright/test";

export const ADMIN = process.env.ADMIN_URL ?? "http://localhost:3001";
export const WEB = process.env.WEB_URL ?? "http://localhost:3000";
export const TENANT = process.env.E2E_TENANT ?? "apex-drive";
export const PASSWORD = process.env.E2E_PASSWORD ?? "DemoPassw0rd!";
export const USERS = {
  admin: "admin@platform.demo",
  owner: "owner@apexdrive.demo",
  staff: "staff@apexdrive.demo",
  customer: "customer@example.demo",
} as const;

export async function adminSignIn(page: Page, email: string) {
  await page.goto(`${ADMIN}/sign-in`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password|fjalëkalimi/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in$|^hyr$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

/** Visit a page and assert it rendered: no server error, no raw i18n keys. */
export async function visitClean(page: Page, url: string) {
  const res = await page.goto(url);
  expect(res?.status(), `${url} status`).toBeLessThan(400);
  const text = await page.locator("body").innerText();
  expect(text, `${url} error page`).not.toMatch(/Application error: a (server|client)-side exception|Internal Server Error|This page could not be found/);
  const raw = text.match(/\b(admin|errors|booking|vehicle|common|pricing|documents)\.[a-zA-Z_]+\.?[a-zA-Z_.]*\b/g) ?? [];
  expect(raw.filter((k) => !/@|\.demo$|\.com$/.test(k)), `${url} untranslated keys`).toEqual([]);
  return text;
}

/** First link on the page whose href matches `pattern`. */
export async function firstHref(page: Page, pattern: RegExp): Promise<string | null> {
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.find((h) => pattern.test(h)) ?? null;
}

/** "YYYY-MM-DDTHH:mm" `days` from now at `hour`:00 (for datetime-local inputs). */
export function localDateTime(days: number, hour: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
}
