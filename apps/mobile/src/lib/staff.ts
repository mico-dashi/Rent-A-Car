import type { SupabaseClient } from "@supabase/supabase-js";
import { utcToZonedLocal, zonedLocalToUtc } from "@rental/domain";

export interface StaffBooking {
  id: string; reference: string; status: string; starts_at: string; ends_at: string; vehicle_id: string | null;
  customer: string; vehicle: string; plate: string;
}

const PICKUP_STATUSES = ["CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP"];
const RETURN_STATUSES = ["ACTIVE", "RETURN_DUE"];

/** Today's pickups and returns (plus overdue returns) in the tenant's timezone. RLS scopes to the staff member's branches. */
export async function todayOperations(db: SupabaseClient, tenantId: string, timeZone: string) {
  const today = utcToZonedLocal(new Date(), timeZone).slice(0, 10);
  const dayStart = zonedLocalToUtc(`${today}T00:00`, timeZone).toISOString();
  const dayEnd = new Date(Date.parse(dayStart) + 86_400_000).toISOString();
  const cols = "id,reference,status,starts_at,ends_at,vehicle_id,customer_id";
  const [pickups, returns] = await Promise.all([
    db.from("bookings").select(cols).eq("tenant_id", tenantId).in("status", PICKUP_STATUSES).gte("starts_at", dayStart).lt("starts_at", dayEnd).order("starts_at"),
    db.from("bookings").select(cols).eq("tenant_id", tenantId).in("status", RETURN_STATUSES).lt("ends_at", dayEnd).order("ends_at"),
  ]);
  if (pickups.error) throw new Error(pickups.error.message);
  if (returns.error) throw new Error(returns.error.message);
  const rows = [...(pickups.data ?? []), ...(returns.data ?? [])] as Record<string, string | null>[];
  const vIds = [...new Set(rows.map((r) => r.vehicle_id).filter(Boolean))] as string[];
  const cIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))] as string[];
  const [{ data: vehicles }, { data: customers }] = await Promise.all([
    vIds.length ? db.from("vehicles").select("id,make,model,registration_plate").in("id", vIds) : Promise.resolve({ data: [] }),
    cIds.length ? db.from("customers").select("id,first_name,last_name").in("id", cIds) : Promise.resolve({ data: [] }),
  ]);
  const vm = new Map((vehicles ?? []).map((v: Record<string, string>) => [v.id, v]));
  const cm = new Map((customers ?? []).map((c: Record<string, string>) => [c.id, c]));
  const shape = (r: Record<string, string | null>): StaffBooking => {
    const v = r.vehicle_id ? vm.get(r.vehicle_id) : undefined;
    const c = r.customer_id ? cm.get(r.customer_id) : undefined;
    return {
      id: r.id!, reference: r.reference!, status: r.status!, starts_at: r.starts_at!, ends_at: r.ends_at!, vehicle_id: r.vehicle_id ?? null,
      customer: c ? `${c.first_name} ${c.last_name}` : "—", vehicle: v ? `${v.make} ${v.model}` : "—", plate: v?.registration_plate ?? "",
    };
  };
  return { pickups: (pickups.data ?? []).map(shape), returns: (returns.data ?? []).map(shape) };
}
