"use server";

import { check, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

/** Drag a booking onto another vehicle row. The exclusion constraint validates conflicts. */
export async function moveBookingAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "bookings.write", async () => {
    check(await (await userClient()).rpc("assign_booking_vehicle", { p_booking: str(fd, "bookingId"), p_vehicle: str(fd, "vehicleId"), p_reason: "SUBSTITUTION" }));
  });
}

/** Add a manual or cleaning block (e.g. photo shoot, detailing). */
export async function addBlockAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.status", async (ctx) => {
    const start = str(fd, "start"), end = str(fd, "end");
    if (!start || !end || end <= start) throw new Error("INVALID_RENTAL_WINDOW");
    const { zonedLocalToUtc } = await import("@rental/domain");
    const kind = str(fd, "kind") === "CLEANING" ? "CLEANING" : "MANUAL";
    check(await (await userClient()).from("vehicle_availability_blocks").insert({
      tenant_id: ctx.tenantId, vehicle_id: str(fd, "vehicleId")!, kind,
      period: `[${zonedLocalToUtc(start, ctx.timezone).toISOString()},${zonedLocalToUtc(end, ctx.timezone).toISOString()})`, reason: str(fd, "reason"), created_by: ctx.userId,
    }));
  });
}

export async function releaseBlockAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.status", async () => {
    check(await (await userClient()).from("vehicle_availability_blocks").update({ released_at: new Date().toISOString() }).eq("id", str(fd, "blockId")!).in("kind", ["MANUAL", "CLEANING"]));
  });
}
