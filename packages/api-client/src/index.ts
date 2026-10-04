import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessErrorCode, CatalogVehicle, PriceLine, ResolvedTenant, VehicleCategory } from "@rental/types";
import { BusinessError, isBusinessErrorCode } from "@rental/types";
import type { CreateBookingRequest, QuoteRequest } from "@rental/validation";

/** Thin, typed data-access layer shared by web and mobile. All calls respect RLS. */

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) {
    const code = result.error.message.trim();
    throw new BusinessError(isBusinessErrorCode(code) ? code : ("INTERNAL_ERROR" satisfies BusinessErrorCode));
  }
  return result.data as T;
}

export async function resolveTenant(client: SupabaseClient, by: { hostname?: string; slug?: string; code?: string }): Promise<ResolvedTenant | null> {
  const data = unwrap(await client.rpc("resolve_tenant", { p_hostname: by.hostname ?? null, p_slug: by.slug ?? null, p_code: by.code ?? null }));
  return (data as ResolvedTenant | null) ?? null;
}

export interface Branch {
  id: string;
  name: string;
  address_line1: string;
  city: string;
  country_code: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  opening_hours: Record<string, { open: string; close: string }[]>;
  pickup_instructions: string | null;
  airport_code: string | null;
}

export async function listBranches(client: SupabaseClient, tenantId: string): Promise<Branch[]> {
  return unwrap(await client.from("branches")
    .select("id,name,address_line1,city,country_code,latitude,longitude,phone,email,timezone,opening_hours,pickup_instructions,airport_code")
    .eq("tenant_id", tenantId).eq("is_active", true).order("name")) as Branch[];
}

export async function listCatalog(client: SupabaseClient, tenantId: string, opts: { category?: VehicleCategory; limit?: number } = {}): Promise<CatalogVehicle[]> {
  let q = client.from("catalog_vehicles").select("*").eq("tenant_id", tenantId).order("daily_rate_minor", { ascending: false }).limit(opts.limit ?? 48);
  if (opts.category) q = q.eq("category", opts.category);
  return unwrap(await q) as CatalogVehicle[];
}

export async function getCatalogVehicle(client: SupabaseClient, tenantId: string, vehicleId: string): Promise<CatalogVehicle | null> {
  return unwrap(await client.from("catalog_vehicles").select("*").eq("tenant_id", tenantId).eq("id", vehicleId).maybeSingle()) as CatalogVehicle | null;
}

export async function listVehicleImages(client: SupabaseClient, vehicleId: string) {
  return unwrap(await client.from("vehicle_images").select("id,storage_path,thumbnail_path,width,height,alt_text,kind").eq("vehicle_id", vehicleId).order("sort_order")) as {
    id: string; storage_path: string; thumbnail_path: string | null; width: number | null; height: number | null; alt_text: string | null; kind: string;
  }[];
}

export async function searchAvailable(client: SupabaseClient, q: {
  tenantId: string; pickupBranchId: string; startsAt: string; endsAt: string; category?: VehicleCategory; limit?: number; offset?: number;
}): Promise<CatalogVehicle[]> {
  return unwrap(await client.rpc("search_available_vehicles", {
    p_tenant: q.tenantId, p_starts_at: q.startsAt, p_ends_at: q.endsAt, p_pickup_branch: q.pickupBranchId,
    p_category: q.category ?? null, p_limit: q.limit ?? 50, p_offset: q.offset ?? 0,
  })) as CatalogVehicle[];
}

export async function listExtras(client: SupabaseClient, tenantId: string) {
  return unwrap(await client.from("extras").select("id,code,name,description,kind,billing,price_minor,max_price_minor,max_quantity,deposit_reduction_bps").eq("tenant_id", tenantId).eq("is_active", true).order("sort_order"));
}

export async function transitionBooking(client: SupabaseClient, bookingId: string, to: string, reason?: string, expectedVersion?: number) {
  return unwrap(await client.rpc("transition_booking", { p_booking: bookingId, p_to: to, p_reason: reason ?? null, p_expected_version: expectedVersion ?? null })) as {
    id: string; status: string; version: number; cancellation_fee_minor: number; refundable_minor: number;
  };
}

// ---- HTTP API (server routes that price and create bookings) ----------------

export interface QuoteResponse {
  currency: string;
  days: number;
  lines: PriceLine[];
  totalMinor: number;
  depositMinor: number;
  dueNowMinor: number;
  dueLaterMinor: number;
  taxMinor: number;
  includedKm: number | null;
}

export interface ApiErrorBody {
  error: { code: BusinessErrorCode; details?: unknown };
}

export class HttpApi {
  constructor(private readonly baseUrl: string, private readonly getAccessToken: () => Promise<string | null>) {}

  private async request<T>(path: string, body: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
    if (!res.ok) {
      const code = (json as ApiErrorBody | null)?.error?.code;
      throw new BusinessError(code && isBusinessErrorCode(code) ? code : "INTERNAL_ERROR", res.status);
    }
    return json as T;
  }

  quote(input: QuoteRequest) {
    return this.request<QuoteResponse>("/api/v1/quotes", input);
  }

  /** Hosted identity verification: returns the provider URL to open, or alreadyVerified. */
  startIdentityVerification() {
    return this.request<{ alreadyVerified: boolean; url?: string }>("/api/v1/identity/session", {});
  }

  createBooking(input: CreateBookingRequest) {
    return this.request<{ id: string; reference: string; status: string; holdExpiresAt: string | null; payment: { clientSecret: string | null } | null }>(
      "/api/v1/bookings", input);
  }
}
export * from "./inspections";

export interface NearbyTenant {
  slug: string;
  display_name: string;
  logo_path: string | null;
  primary_color: string | null;
  branch_name: string;
  city: string | null;
  distance_km: number;
}

/** Active rental companies with a branch near a point (universal app discovery; empty when the feature is off). */
export async function nearbyTenants(client: SupabaseClient, lat: number, lng: number, radiusKm = 50): Promise<NearbyTenant[]> {
  const rows = unwrap(await client.rpc("nearby_tenants", { p_lat: lat, p_lng: lng, p_radius_km: radiusKm, p_limit: 20 })) as NearbyTenant[] | null;
  return (rows ?? []).map((r) => ({ ...r, distance_km: Number(r.distance_km) }));
}
