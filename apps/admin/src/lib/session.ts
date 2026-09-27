import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Permission, RoleKey, TenantStatus, CurrencyCode } from "@rental/types";
import { enforceMfa } from "./mfa";
import { userClient } from "./supabase/server";

export interface TenantContext {
  userId: string;
  email: string | null;
  tenantId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  role: RoleKey | "PLATFORM_ADMIN";
  branchIds: string[];
  permissions: Set<Permission>;
  currency: CurrencyCode;
  timezone: string;
  isPlatformAdmin: boolean;
}

export const getUser = cache(async () => {
  const db = await userClient();
  const { data } = await db.auth.getUser();
  return data.user ?? null;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  return user;
}

export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const db = await userClient();
  const { data } = await db.rpc("am_platform_admin");
  return data === true;
});

export const myMemberships = cache(async () => {
  const db = await userClient();
  const { data, error } = await db.rpc("my_memberships");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as {
    tenant_id: string; tenant_slug: string; tenant_name: string; tenant_status: TenantStatus; role: RoleKey; branch_ids: string[]; permissions: Permission[];
  }[];
});

/**
 * Resolve the dashboard tenant from the URL slug. Members get their effective
 * permissions; platform admins get read-only access for support.
 * These drive UI affordances only — RLS and RPCs enforce.
 */
export const getTenantContext = cache(async (slug: string): Promise<TenantContext> => {
  const user = await requireUser();
  const db = await userClient();
  const m = (await myMemberships()).find((x) => x.tenant_slug === slug);
  const admin = await isPlatformAdmin();
  if (!m && !admin) notFound();
  await enforceMfa({ privileged: admin || m?.role === "TENANT_OWNER" || m?.role === "TENANT_ADMIN", next: `/t/${slug}` });
  const { data: tenant } = await db.from("tenants").select("id,slug,display_name,status,base_currency").eq("slug", slug).maybeSingle();
  if (!tenant) notFound();
  const { data: settings } = await db.from("tenant_settings").select("timezone").eq("tenant_id", tenant.id).maybeSingle();
  const readOnly = new Set<Permission>([
    "tenant.read", "branches.read", "vehicles.read", "pricing.read", "bookings.read", "payments.read", "customers.read",
    "damages.read", "maintenance.read", "expenses.read", "staff.read", "reports.read", "messages.read", "audit.read",
  ]);
  return {
    userId: user.id, email: user.email ?? null, tenantId: tenant.id, slug: tenant.slug, name: tenant.display_name, status: tenant.status,
    role: m?.role ?? "PLATFORM_ADMIN", branchIds: m?.branch_ids ?? [], permissions: m ? new Set(m.permissions) : readOnly,
    currency: tenant.base_currency as CurrencyCode, timezone: settings?.timezone ?? "UTC", isPlatformAdmin: admin,
  };
});

export function can(ctx: TenantContext, p: Permission): boolean {
  return ctx.permissions.has(p);
}

export function requirePermission(ctx: TenantContext, p: Permission): void {
  if (!can(ctx, p)) redirect(`/t/${ctx.slug}/forbidden`);
}
