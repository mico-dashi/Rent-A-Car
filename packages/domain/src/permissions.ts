import type { Permission, RoleKey } from "@rental/types";
import { PERMISSIONS } from "@rental/types";

const all = PERMISSIONS;

/**
 * Default role grants. MUST match public.role_permissions (migration 0003);
 * enforced by packages/database/test/parity.test.ts. The database remains the
 * enforcement point — this map drives UI affordances and server pre-checks.
 */
export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly Permission[]>> = {
  TENANT_OWNER: all,
  TENANT_ADMIN: all.filter((p) => p !== "billing.manage"),
  MANAGER: [
    "tenant.read", "branches.read", "vehicles.read", "vehicles.write", "vehicles.status", "pricing.read",
    "bookings.read", "bookings.write", "bookings.cancel", "payments.read", "payments.charge", "deposits.manage",
    "customers.read", "customers.write", "customers.restrict", "customers.documents", "inspections.perform",
    "damages.read", "damages.manage", "maintenance.read", "maintenance.manage", "expenses.read",
    "expenses.manage", "transfers.manage", "staff.read", "reports.read", "messages.read", "messages.write",
    "reviews.reply", "agreements.manage",
  ],
  EMPLOYEE: [
    "tenant.read", "branches.read", "vehicles.read", "vehicles.status", "pricing.read", "bookings.read",
    "bookings.write", "payments.read", "customers.read", "customers.write", "customers.documents",
    "inspections.perform", "damages.read", "maintenance.read", "messages.read", "messages.write",
    "agreements.manage",
  ],
  DRIVER: [
    "tenant.read", "branches.read", "vehicles.read", "vehicles.status", "bookings.read",
    "inspections.perform", "transfers.manage", "messages.read",
  ],
};

export const ROLE_RANK: Readonly<Record<RoleKey, number>> = {
  TENANT_OWNER: 10,
  TENANT_ADMIN: 20,
  MANAGER: 30,
  EMPLOYEE: 40,
  DRIVER: 50,
};

export interface MembershipContext {
  role: RoleKey;
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  overrides?: Partial<Record<Permission, boolean>>;
  tenantStatus: "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
}

/** Same semantics as app.user_has_permission in SQL. */
export function hasPermission(ctx: MembershipContext | null, permission: Permission): boolean {
  if (!ctx || ctx.status !== "ACTIVE") return false;
  if (ctx.tenantStatus === "ARCHIVED") return false;
  if (ctx.tenantStatus === "SUSPENDED" && !permission.endsWith(".read")) return false;
  const override = ctx.overrides?.[permission];
  if (override !== undefined) return override;
  return ROLE_PERMISSIONS[ctx.role].includes(permission);
}

/** Whether `actor` may assign `target` role (mirrors app.guard_membership_write). */
export function canAssignRole(actor: RoleKey, target: RoleKey): boolean {
  if (target === "TENANT_OWNER") return false;
  if (actor === "TENANT_OWNER") return true;
  return ROLE_RANK[target] > ROLE_RANK[actor];
}
