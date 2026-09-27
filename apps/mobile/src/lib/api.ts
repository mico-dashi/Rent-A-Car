import { HttpApi } from "@rental/api-client";
import type { ResolvedTenant } from "@rental/types";
import { appConfig } from "./config";
import { supabase } from "./supabase";

/**
 * The tenant's website origin. Pricing and booking creation run on the web
 * server (service-side pricing, idempotency, payments), which resolves the
 * tenant from the Host, so requests go to the tenant's own domain.
 */
export function tenantOrigin(tenant: ResolvedTenant): string | null {
  if (appConfig.apiBaseUrl) return appConfig.apiBaseUrl.replace(/\/$/, "");
  const host = tenant.primaryHostname ?? appConfig.client?.websiteDomain;
  return host ? `https://${host}` : null;
}

export function httpApi(tenant: ResolvedTenant): HttpApi | null {
  const origin = tenantOrigin(tenant);
  if (!origin) return null;
  return new HttpApi(origin, async () => (await supabase().auth.getSession()).data.session?.access_token ?? null);
}
