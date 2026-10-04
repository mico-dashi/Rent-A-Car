import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenant } from "@rental/api-client";
import type { ResolvedTenant } from "@rental/types";
import { publicClient } from "./supabase/server";

const TTL_MS = 60_000;
const memo = new Map<string, { at: number; value: ResolvedTenant | null }>();

/** Normalise the Host header: strip port, lowercase, map dev hosts. */
export function tenantLookupFromHost(host: string | null): { hostname?: string; slug?: string } {
  const hostname = (host ?? "").split(":")[0]!.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
    // Plain localhost in development: use DEV_TENANT_SLUG (never in production).
    const slug = process.env.NODE_ENV !== "production" ? process.env.DEV_TENANT_SLUG : undefined;
    return slug ? { slug } : {};
  }
  return { hostname };
}

async function lookup(key: { hostname?: string; slug?: string }): Promise<ResolvedTenant | null> {
  const cacheKey = key.hostname ?? `slug:${key.slug ?? ""}`;
  const hit = memo.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = key.hostname || key.slug ? await resolveTenant(publicClient(), key) : null;
  memo.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** The tenant for this request (by custom domain or platform subdomain). */
export const getTenantOrNull = cache(async (): Promise<ResolvedTenant | null> => {
  const h = await headers();
  return lookup(tenantLookupFromHost(h.get("x-forwarded-host") ?? h.get("host")));
});

export async function getTenant(): Promise<ResolvedTenant> {
  const tenant = await getTenantOrNull();
  if (!tenant) notFound();
  return tenant;
}
