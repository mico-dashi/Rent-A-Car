import { expect, test } from "@playwright/test";
import { ADMIN, TENANT, USERS, adminSignIn, firstHref, localDateTime, visitClean } from "./helpers";

const SECTIONS = ["", "/today", "/bookings", "/bookings/new", "/calendar", "/calendar?view=timeline", "/fleet", "/fleet/new", "/fleet/classes",
  "/customers", "/customers/new", "/branches", "/pricing", "/extras", "/maintenance", "/damages", "/expenses", "/employees", "/payments",
  "/reports", "/messages", "/messages/new", "/reviews", "/website", "/branding", "/settings", "/audit", "/onboarding"];

test.describe("owner dashboard", () => {
  test.beforeEach(async ({ page }) => adminSignIn(page, USERS.owner));

  test("every section renders without errors or missing translations", async ({ page }) => {
    for (const s of SECTIONS) await visitClean(page, `${ADMIN}/t/${TENANT}${s}`);
  });

  test("creates a walk-in booking through the booking engine", async ({ page }) => {
    await page.goto(`${ADMIN}/t/${TENANT}/bookings/new`);
    // Required selects default to their first option (customer, vehicle, pickup branch).
    const offset = 20 + Math.floor(Math.random() * 200); // unique window so reruns don't collide
    await page.locator('input[name="start"]').fill(localDateTime(offset, 10));
    await page.locator('input[name="end"]').fill(localDateTime(offset + 3, 10));
    await page.getByRole("button", { name: "Create booking" }).click();
    await page.waitForURL(/\/bookings\/[0-9a-f-]{36}$/);
    const text = await visitClean(page, page.url());
    expect(text).toContain("Confirmed");
  });

  test("detail pages render", async ({ page }) => {
    for (const [list, pattern] of [
      ["/bookings", /\/bookings\/[0-9a-f-]{36}$/],
      ["/fleet", /\/fleet\/[0-9a-f-]{36}$/],
      ["/customers", /\/customers\/[0-9a-f-]{36}$/],
    ] as const) {
      await visitClean(page, `${ADMIN}/t/${TENANT}${list}`);
      const href = await firstHref(page, pattern);
      expect(href, `a detail link on ${list}`).toBeTruthy();
      await visitClean(page, new URL(href!, ADMIN).toString());
    }
  });

  test("Albanian UI is fully translated", async ({ page, context }) => {
    await context.addCookies([{ name: "lang", value: "sq", url: ADMIN }]);
    for (const s of ["", "/bookings", "/fleet", "/settings", "/reports"]) {
      const text = await visitClean(page, `${ADMIN}/t/${TENANT}${s}`);
      expect(text).toMatch(/Rezervimet|Flota|Cilësimet|Raportet/);
    }
  });

  test("records an expense", async ({ page }) => {
    await page.goto(`${ADMIN}/t/${TENANT}/expenses`);
    const vendor = `E2E Garage ${Date.now()}`;
    await page.locator('input[name="description"]').fill("E2E brake pads");
    await page.locator('input[name="vendor"]').fill(vendor);
    await page.locator('input[name="amount"]').fill("42.50");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(vendor)).toBeVisible();
  });
});

test.describe("staff permissions", () => {
  test("employee sees operations but not team or settings management", async ({ page }) => {
    await adminSignIn(page, USERS.staff);
    const text = await visitClean(page, `${ADMIN}/t/${TENANT}/today`);
    expect(text).toContain("Today");
    const nav = await page.getByRole("navigation").first().innerText();
    expect(nav).not.toContain("Team");
    expect(nav).not.toContain("Audit log");
    await page.goto(`${ADMIN}/t/${TENANT}/employees`);
    await expect(page).toHaveURL(/forbidden/);
  });

  test("customer accounts cannot open the dashboard", async ({ page }) => {
    await adminSignIn(page, USERS.customer);
    const res = await page.goto(`${ADMIN}/t/${TENANT}`);
    expect([403, 404]).toContain(res?.status());
  });
});

test.describe("platform console", () => {
  test("super admin pages render", async ({ page }) => {
    await adminSignIn(page, USERS.admin);
    for (const s of ["", "/tenants", "/plans", "/catalog", "/system", "/privacy", "/audit"]) await visitClean(page, `${ADMIN}/platform${s}`);
    await visitClean(page, `${ADMIN}/platform/tenants`);
    const href = await firstHref(page, /\/platform\/tenants\/[0-9a-f-]{36}$/);
    expect(href).toBeTruthy();
    await visitClean(page, new URL(href!, ADMIN).toString());
  });

  test("owners cannot open the platform console", async ({ page }) => {
    await adminSignIn(page, USERS.owner);
    const res = await page.goto(`${ADMIN}/platform`);
    expect(res?.status()).toBe(404);
  });
});
