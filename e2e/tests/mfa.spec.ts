import { expect, test } from "@playwright/test";
import { ADMIN, TENANT, USERS, adminSignIn, totp } from "./helpers";

const AUTH_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Remove every MFA factor of a user through the Auth admin API (test cleanup). */
async function resetFactors(email: string) {
  const headers = { apikey: SERVICE_KEY!, authorization: `Bearer ${SERVICE_KEY}` };
  const list = (await (await fetch(`${AUTH_URL}/auth/v1/admin/users?per_page=100`, { headers })).json()) as { users: { id: string; email: string }[] };
  const id = list.users.find((u) => u.email === email)?.id;
  if (!id) throw new Error(`test user ${email} not found`);
  // The list endpoint omits factors; the single-user endpoint includes them.
  const user = (await (await fetch(`${AUTH_URL}/auth/v1/admin/users/${id}`, { headers })).json()) as { factors?: { id: string }[] };
  for (const f of user.factors ?? []) {
    const res = await fetch(`${AUTH_URL}/auth/v1/admin/users/${id}/factors/${f.id}`, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`could not delete MFA factor (${res.status})`);
  }
}

test.describe("two-factor authentication", () => {
  test.skip(!AUTH_URL || !SERVICE_KEY, "needs the local stack env (tools/local-stack/.data/stack.env)");
  test.beforeAll(() => resetFactors(USERS.staff));
  test.afterAll(() => resetFactors(USERS.staff));

  test("enrol TOTP in settings, then every new session must pass the second factor", async ({ browser }) => {
    const first = await browser.newPage();
    await adminSignIn(first, USERS.staff);
    await first.goto(`${ADMIN}/t/${TENANT}/settings`);
    await first.getByRole("button", { name: "Enable two-factor authentication" }).click();
    const secret = (await first.getByText(/^[A-Z2-7]{16,}$/).innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    await first.getByLabel("Authentication code").fill(totp(secret));
    await first.getByRole("button", { name: "Verify code" }).click();
    await expect(first.getByText("Two-factor authentication is on.")).toBeVisible();
    await first.close();

    const second = await browser.newPage();
    await adminSignIn(second, USERS.staff);
    await second.goto(`${ADMIN}/t/${TENANT}/today`);
    await expect(second).toHaveURL(/\/mfa\?next=/);
    await second.getByLabel("Authentication code").fill("000000");
    await second.getByRole("button", { name: "Verify code" }).click();
    await expect(second.getByRole("alert")).toBeVisible();
    await second.getByLabel("Authentication code").fill(totp(secret));
    await second.getByRole("button", { name: "Verify code" }).click();
    await second.waitForURL(new RegExp(`/t/${TENANT}`));
    await second.goto(`${ADMIN}/t/${TENANT}/today`);
    await expect(second).toHaveURL(new RegExp(`/t/${TENANT}/today$`));
    await second.close();
  });
});
