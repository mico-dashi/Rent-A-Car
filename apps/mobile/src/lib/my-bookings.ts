import type { SupabaseClient } from "@supabase/supabase-js";

export interface MyBookingRow {
  id: string; reference: string; status: string; starts_at: string; ends_at: string; total_minor: number; currency: string; version: number;
  amount_paid_minor: number; amount_refunded_minor: number; vehicle: { make: string; model: string } | null; pickup: { name: string; timezone: string } | null;
}

/**
 * The signed-in user's own bookings in this tenant. Filtered by their customer
 * record explicitly, because a staff member's RLS scope also covers other
 * customers' bookings.
 */
export async function myBookings(db: SupabaseClient, tenantId: string, userId: string, bookingId?: string): Promise<MyBookingRow[]> {
  const { data: customers } = await db.from("customers").select("id").eq("tenant_id", tenantId).eq("user_id", userId);
  const ids = (customers ?? []).map((c: { id: string }) => c.id);
  if (!ids.length) return [];
  let q = db.from("bookings").select("id,reference,status,starts_at,ends_at,total_minor,currency,version,amount_paid_minor,amount_refunded_minor,vehicle_id,pickup_branch_id")
    .eq("tenant_id", tenantId).in("customer_id", ids).order("starts_at", { ascending: false }).limit(100);
  if (bookingId) q = q.eq("id", bookingId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  const vIds = [...new Set(rows.map((r) => r.vehicle_id).filter(Boolean))] as string[];
  const [{ data: vehicles }, { data: branches }] = await Promise.all([
    vIds.length ? db.from("catalog_vehicles").select("id,make,model").in("id", vIds) : Promise.resolve({ data: [] }),
    db.from("branches").select("id,name,timezone").eq("tenant_id", tenantId),
  ]);
  const vm = new Map((vehicles ?? []).map((v: Record<string, unknown>) => [v.id, v]));
  const bm = new Map((branches ?? []).map((b: Record<string, unknown>) => [b.id, b]));
  return rows.map((r) => ({
    ...(r as unknown as MyBookingRow),
    total_minor: Number(r.total_minor), amount_paid_minor: Number(r.amount_paid_minor), amount_refunded_minor: Number(r.amount_refunded_minor),
    vehicle: (vm.get(r.vehicle_id) as MyBookingRow["vehicle"]) ?? null,
    pickup: (bm.get(r.pickup_branch_id) as MyBookingRow["pickup"]) ?? null,
  }));
}
