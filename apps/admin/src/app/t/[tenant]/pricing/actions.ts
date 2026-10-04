"use server";

import { pricingRuleSchema, z } from "@rental/validation";
import { VEHICLE_CATEGORIES } from "@rental/types";
import { bool, check, money, num, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

const pct = (fd: FormData, k: string) => { const v = num(fd, k); return v === null ? null : Math.round(v * 100); }; // percent -> bps

export async function saveRuleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "pricing.manage", async (ctx) => {
    const kind = str(fd, "kind");
    const condition: Record<string, number | number[] | null> = {};
    if (kind === "WEEKEND_SURCHARGE") condition.days = fd.getAll("days").map(Number);
    if (kind === "DURATION_DISCOUNT") condition.minDays = num(fd, "minDays");
    if (kind === "LEAD_TIME") condition.withinHours = num(fd, "withinHours");
    if (kind === "UTILIZATION") condition.above = (num(fd, "above") ?? 0) / 100;
    if (kind === "YOUNG_DRIVER_FEE") condition.belowAge = num(fd, "belowAge");
    const adjustmentBps = pct(fd, "adjustmentPct");
    const amountMinor = money(fd, "amount");
    pricingRuleSchema.parse({ kind, condition, ...(adjustmentBps !== null ? { adjustmentBps } : {}), ...(amountMinor !== null ? { amountMinor } : {}) });
    const row = {
      tenant_id: ctx.tenantId, name: z.string().min(2).max(80).parse(str(fd, "name")), kind: kind!, condition,
      is_dynamic: kind === "LEAD_TIME" || kind === "UTILIZATION", adjustment_bps: adjustmentBps, amount_minor: amountMinor,
      per: z.enum(["BOOKING", "DAY"]).parse(str(fd, "per") ?? "BOOKING"), priority: num(fd, "priority") ?? 100, is_active: bool(fd, "is_active"),
    };
    const id = str(fd, "ruleId");
    const db = await userClient();
    check(id ? await db.from("pricing_rules").update(row).eq("id", id).eq("tenant_id", ctx.tenantId) : await db.from("pricing_rules").insert(row));
  });
}

export async function deleteRowAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "pricing.manage", async (ctx) => {
    const table = z.enum(["pricing_rules", "seasonal_rates", "tax_rules", "discount_codes"]).parse(str(fd, "table"));
    check(await (await userClient()).from(table).delete().eq("id", str(fd, "id")!).eq("tenant_id", ctx.tenantId));
  });
}

export async function saveSeasonAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "pricing.manage", async (ctx) => {
    const cat = str(fd, "category");
    check(await (await userClient()).from("seasonal_rates").insert({
      tenant_id: ctx.tenantId, name: z.string().min(2).parse(str(fd, "name")), starts_on: str(fd, "starts_on")!, ends_on: str(fd, "ends_on")!,
      adjustment_bps: z.number().int().min(-9000).max(50000).parse(pct(fd, "adjustmentPct")), priority: num(fd, "priority") ?? 100,
      category: cat ? z.enum(VEHICLE_CATEGORIES).parse(cat) : null,
    }));
  });
}

export async function saveTaxAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "pricing.manage", async (ctx) => {
    check(await (await userClient()).from("tax_rules").insert({
      tenant_id: ctx.tenantId, name: z.string().min(1).max(40).parse(str(fd, "name")), rate_bps: z.number().int().min(0).max(10000).parse(pct(fd, "ratePct")),
      is_inclusive: bool(fd, "is_inclusive"), jurisdiction_label: str(fd, "jurisdiction"), effective_from: str(fd, "effective_from")!, effective_to: str(fd, "effective_to"),
      applies_to: fd.getAll("applies_to").map(String).filter((x) => ["RENTAL", "EXTRAS", "FEES"].includes(x)),
    }));
  });
}

export async function saveDiscountAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "pricing.manage", async (ctx) => {
    const percent = pct(fd, "percent");
    const amount = money(fd, "amount");
    if ((percent === null) === (amount === null)) throw new Error("VALIDATION_FAILED");
    check(await (await userClient()).from("discount_codes").insert({
      tenant_id: ctx.tenantId, code: z.string().regex(/^[A-Za-z0-9_-]{3,40}$/).parse(str(fd, "code"))!.toUpperCase(), percent_off_bps: percent, amount_off_minor: amount,
      min_rental_days: num(fd, "min_days"), valid_from: str(fd, "valid_from"), valid_until: str(fd, "valid_until"), max_redemptions: num(fd, "max_redemptions"),
    }));
  });
}

export async function toggleDiscountAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "pricing.manage", async (ctx) => {
    check(await (await userClient()).from("discount_codes").update({ is_active: str(fd, "active") === "1" }).eq("id", str(fd, "id")!).eq("tenant_id", ctx.tenantId));
  });
}
