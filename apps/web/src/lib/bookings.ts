import "server-only";
import type { SupabaseClient } from "@rental/auth";
import type { BookingStatus, CurrencyCode } from "@rental/types";

export interface MyBooking {
  id: string;
  reference: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  total_minor: number;
  currency: CurrencyCode;
  version: number;
  payment_status: string;
  amount_paid_minor: number;
  amount_refunded_minor: number;
  cancellation_fee_minor: number | null;
  vehicle: { make: string; model: string } | null;
  pickup: { name: string; timezone: string } | null;
  ret: { name: string } | null;
}


/** Customer's own bookings in this tenant — RLS restricts to rows they own. */
export async function myBookings(db: SupabaseClient, tenantId: string): Promise<MyBooking[]> {
  const { data, error } = await db.from("bookings")
    .select("id,reference,status,starts_at,ends_at,total_minor,currency,version,payment_status,amount_paid_minor,amount_refunded_minor,cancellation_fee_minor,vehicle_id,pickup_branch_id,return_branch_id")
    .eq("tenant_id", tenantId).order("starts_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return hydrate(db, tenantId, (data ?? []) as Record<string, unknown>[]);
}

export async function myBooking(db: SupabaseClient, tenantId: string, id: string) {
  const { data, error } = await db.from("bookings")
    .select("id,reference,status,starts_at,ends_at,total_minor,currency,version,payment_status,amount_paid_minor,amount_refunded_minor,cancellation_fee_minor,vehicle_id,pickup_branch_id,return_branch_id,deposit_minor,due_now_minor")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [b] = await hydrate(db, tenantId, [data as Record<string, unknown>]);
  const { data: lines } = await db.from("booking_price_lines").select("kind,label,quantity,unit_amount_minor,amount_minor,is_taxable").eq("booking_id", id).order("sort_order");
  return { ...b!, deposit_minor: Number(data.deposit_minor), due_now_minor: Number(data.due_now_minor), lines: (lines ?? []) as Record<string, unknown>[] };
}

async function hydrate(db: SupabaseClient, tenantId: string, rows: Record<string, unknown>[]): Promise<MyBooking[]> {
  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id).filter(Boolean))] as string[];
  const [{ data: vehicles }, { data: branches }] = await Promise.all([
    vehicleIds.length ? db.from("catalog_vehicles").select("id,make,model").in("id", vehicleIds) : Promise.resolve({ data: [] }),
    db.from("branches").select("id,name,timezone").eq("tenant_id", tenantId),
  ]);
  const vmap = new Map((vehicles ?? []).map((v: Record<string, unknown>) => [v.id, v]));
  const bmap = new Map((branches ?? []).map((b: Record<string, unknown>) => [b.id, b]));
  return rows.map((r) => ({
    ...(r as unknown as MyBooking),
    total_minor: Number(r.total_minor), amount_paid_minor: Number(r.amount_paid_minor), amount_refunded_minor: Number(r.amount_refunded_minor),
    cancellation_fee_minor: r.cancellation_fee_minor === null ? null : Number(r.cancellation_fee_minor),
    vehicle: (vmap.get(r.vehicle_id) as MyBooking["vehicle"]) ?? null,
    pickup: (bmap.get(r.pickup_branch_id) as MyBooking["pickup"]) ?? null,
    ret: (bmap.get(r.return_branch_id) as MyBooking["ret"]) ?? null,
  }));
}
