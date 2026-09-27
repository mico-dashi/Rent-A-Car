import { describe, expect, it } from "vitest";
import { canAssignRole, hasPermission } from "../src/permissions";

describe("permissions", () => {
  const ctx = { role: "EMPLOYEE" as const, status: "ACTIVE" as const, tenantStatus: "ACTIVE" as const };
  it("grants role defaults", () => {
    expect(hasPermission(ctx, "bookings.write")).toBe(true);
    expect(hasPermission(ctx, "payments.refund")).toBe(false);
    expect(hasPermission({ ...ctx, role: "TENANT_ADMIN" }, "billing.manage")).toBe(false);
    expect(hasPermission({ ...ctx, role: "TENANT_OWNER" }, "billing.manage")).toBe(true);
  });
  it("applies overrides", () => {
    expect(hasPermission({ ...ctx, overrides: { "payments.refund": true } }, "payments.refund")).toBe(true);
    expect(hasPermission({ ...ctx, overrides: { "bookings.write": false } }, "bookings.write")).toBe(false);
  });
  it("denies suspended memberships and makes suspended tenants read-only", () => {
    expect(hasPermission({ ...ctx, status: "SUSPENDED" }, "bookings.read")).toBe(false);
    expect(hasPermission({ ...ctx, tenantStatus: "SUSPENDED" }, "bookings.read")).toBe(true);
    expect(hasPermission({ ...ctx, tenantStatus: "SUSPENDED" }, "bookings.write")).toBe(false);
    expect(hasPermission(null, "bookings.read")).toBe(false);
  });
  it("prevents privilege escalation", () => {
    expect(canAssignRole("TENANT_ADMIN", "MANAGER")).toBe(true);
    expect(canAssignRole("TENANT_ADMIN", "TENANT_ADMIN")).toBe(false);
    expect(canAssignRole("MANAGER", "TENANT_ADMIN")).toBe(false);
    expect(canAssignRole("TENANT_OWNER", "TENANT_OWNER")).toBe(false);
    expect(canAssignRole("TENANT_OWNER", "TENANT_ADMIN")).toBe(true);
  });
});
