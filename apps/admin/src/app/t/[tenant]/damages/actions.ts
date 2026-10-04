"use server";

import { DAMAGE_STATUSES } from "@rental/types";
import { z } from "@rental/validation";
import { check, money, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

/** Human decision on a damage. The DB stamps decided_by/at; charges require CUSTOMER_RESPONSIBLE. */
export async function decideDamageAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "damages.manage", async (ctx) => {
    const status = z.enum(DAMAGE_STATUSES).parse(str(fd, "status"));
    const responsibility = str(fd, "responsibility");
    const est = money(fd, "estimated"), act = money(fd, "actual");
    check(await (await userClient()).from("vehicle_damages").update({
      status, ...(responsibility ? { responsibility: z.enum(["CUSTOMER", "COMPANY", "INSURANCE", "THIRD_PARTY", "UNDETERMINED"]).parse(responsibility) } : {}),
      ...(est !== null ? { estimated_cost_minor: est, currency: ctx.currency } : {}), ...(act !== null ? { actual_cost_minor: act, currency: ctx.currency } : {}),
    }).eq("id", str(fd, "damageId")!).eq("tenant_id", ctx.tenantId));
  });
}

export async function reviewAiAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "damages.manage", async (ctx) => {
    check(await (await userClient()).from("damage_ai_assessments").update({
      review_status: z.enum(["CONFIRMED", "DISMISSED"]).parse(str(fd, "decision")), reviewed_by: ctx.userId, reviewed_at: new Date().toISOString(),
    }).eq("id", str(fd, "assessmentId")!).eq("tenant_id", ctx.tenantId));
  });
}

export async function markVehicleDamagedAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.status", async (ctx) => {
    check(await (await userClient()).from("vehicles").update({ status: "DAMAGED" }).eq("id", str(fd, "vehicleId")!).eq("tenant_id", ctx.tenantId));
  });
}
