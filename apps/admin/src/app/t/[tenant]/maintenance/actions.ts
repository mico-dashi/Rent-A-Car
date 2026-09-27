"use server";

import { zonedLocalToUtc } from "@rental/domain";
import { z } from "@rental/validation";
import { check, money, num, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@rental/database";

export async function scheduleMaintenanceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "maintenance.manage", async (ctx) => {
    const type = z.enum(["OIL", "TIRES", "BRAKES", "REPAIR", "INSPECTION", "CLEANING", "CUSTOM"]).parse(str(fd, "type"));
    const start = str(fd, "start"), end = str(fd, "end");
    if (!start || !end || end <= start) throw new Error("INVALID_RENTAL_WINDOW");
    const cost = money(fd, "cost");
    check(await (await userClient()).from("maintenance_records").insert({
      tenant_id: ctx.tenantId, vehicle_id: str(fd, "vehicleId")!, type, custom_type: type === "CUSTOM" ? str(fd, "custom_type") : null, provider: str(fd, "provider"),
      scheduled_start: zonedLocalToUtc(start, ctx.timezone).toISOString(), scheduled_end: zonedLocalToUtc(end, ctx.timezone).toISOString(),
      odometer_km: num(fd, "odometer"), cost_minor: cost, currency: cost !== null ? ctx.currency : null, notes: str(fd, "notes"), created_by: ctx.userId,
    }));
  });
}

export async function updateMaintenanceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "maintenance.manage", async (ctx) => {
    const status = z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]).parse(str(fd, "status"));
    const cost = money(fd, "cost");
    const patch: TablesUpdate<"maintenance_records"> = { status };
    if (status === "COMPLETED") Object.assign(patch, { completed_at: new Date().toISOString(), ...(cost !== null ? { cost_minor: cost, currency: ctx.currency } : {}), ...(num(fd, "odometer") ? { odometer_km: num(fd, "odometer") } : {}) });
    const db = await userClient();
    check(await db.from("maintenance_records").update(patch).eq("id", str(fd, "id")!).eq("tenant_id", ctx.tenantId));
    if (status === "COMPLETED" && cost) {
      const { data: m } = await db.from("maintenance_records").select("vehicle_id,type").eq("id", str(fd, "id")!).single();
      check(await db.from("expenses").insert({ tenant_id: ctx.tenantId, vehicle_id: m!.vehicle_id, maintenance_id: str(fd, "id"), category: m!.type === "REPAIR" ? "REPAIR" : m!.type === "CLEANING" ? "CLEANING" : "MAINTENANCE",
        description: `Maintenance ${m!.type}`, amount_minor: cost, currency: ctx.currency, incurred_on: new Date().toISOString().slice(0, 10), created_by: ctx.userId }));
    }
  });
}
