import { createBrowserClient, createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Permission, RoleKey, TenantStatus } from "@rental/types";

export type { SupabaseClient };

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

/** Browser client — anon key only; the session is stored in cookies set by the server. */
export function createSupabaseBrowserClient(cfg: SupabasePublicConfig): SupabaseClient {
  return createBrowserClient(cfg.url, cfg.anonKey);
}

export interface CookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options: CookieOptions }[]): void;
}

/**
 * Server client acting as the signed-in user (RLS applies). Cookies are
 * httpOnly, Secure (in production) and SameSite=Lax.
 */
export function createSupabaseServerClient(cfg: SupabasePublicConfig, cookies: CookieAdapter, secure: boolean): SupabaseClient {
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (items: { name: string; value: string; options: CookieOptions }[]) =>
        cookies.setAll(items.map((c) => ({ ...c, options: { ...c.options, httpOnly: true, secure, sameSite: "lax", path: "/" } }))),
    },
  });
}

/**
 * Service-role client. BYPASSES RLS — only for trusted server routes
 * (webhooks, booking creation after server-side pricing, cron jobs).
 * Throws if ever evaluated in a browser bundle.
 */
export function createServiceRoleClient(url: string, serviceRoleKey: string): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("Service-role client must never be created in the browser");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface MembershipInfo {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  role: RoleKey;
  branchIds: string[];
  permissions: Permission[];
}

export async function getMyMemberships(client: SupabaseClient): Promise<MembershipInfo[]> {
  const { data, error } = await client.rpc("my_memberships");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    tenantId: r.tenant_id as string,
    tenantSlug: r.tenant_slug as string,
    tenantName: r.tenant_name as string,
    tenantStatus: r.tenant_status as TenantStatus,
    role: r.role as RoleKey,
    branchIds: (r.branch_ids as string[]) ?? [],
    permissions: (r.permissions as Permission[]) ?? [],
  }));
}

export class AuthorizationError extends Error {
  constructor(public readonly status: 401 | 403) {
    super(status === 401 ? "AUTH_REQUIRED" : "FORBIDDEN");
  }
}

export async function requireUser(client: SupabaseClient): Promise<{ id: string; email: string | null }> {
  // getUser() validates the JWT with the auth server (never trust getSession() alone on the server).
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AuthorizationError(401);
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Server-side pre-check for UX and early rejection. RLS/RPCs still enforce. */
export async function requirePermission(client: SupabaseClient, tenantId: string, permission: Permission): Promise<MembershipInfo> {
  await requireUser(client);
  const membership = (await getMyMemberships(client)).find((m) => m.tenantId === tenantId);
  if (!membership || !membership.permissions.includes(permission)) throw new AuthorizationError(403);
  return membership;
}

export async function requirePlatformAdmin(client: SupabaseClient): Promise<void> {
  await requireUser(client);
  const { data, error } = await client.rpc("am_platform_admin");
  if (error || data !== true) throw new AuthorizationError(403);
}
