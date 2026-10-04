"use server";

import { z } from "@rental/validation";
import { bool, check, money, num, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

export async function saveBusinessAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "tenant.manage", async (ctx) => {
    const db = await userClient();
    check(await db.from("tenants").update({
      display_name: z.string().min(2).max(80).parse(str(fd, "display_name")), legal_name: z.string().min(2).max(160).parse(str(fd, "legal_name")),
      default_language: z.enum(["en", "sq"]).parse(str(fd, "default_language")),
    }).eq("id", ctx.tenantId));
    const tz = z.string().parse(str(fd, "timezone"));
    if (!Intl.supportedValuesOf("timeZone").includes(tz) && tz !== "UTC") throw new Error("INVALID_TIMEZONE");
    check(await db.from("tenant_settings").update({ timezone: tz }).eq("tenant_id", ctx.tenantId));
  });
}

export async function saveRulesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "tenant.manage", async (ctx) => {
    const pct = (k: string) => Math.round((num(fd, k) ?? 0) * 100);
    const s = z.object({
      reservation_buffer_minutes: z.number().int().min(0).max(2880), booking_mode: z.enum(["EXACT_VEHICLE", "VEHICLE_CLASS"]), requires_manual_approval: z.boolean(),
      min_rental_minutes: z.number().int().min(60), max_rental_days: z.number().int().min(1).max(366), min_lead_time_minutes: z.number().int().min(0),
      hold_minutes: z.number().int().min(5).max(120), default_min_driver_age: z.number().int().min(16).max(99), young_driver_age_below: z.number().int().min(16).max(99),
      free_cancellation_hours: z.number().int().min(0), late_cancellation_fee_bps: z.number().int().min(0).max(10000),
      payment_timing: z.enum(["FULL_AT_BOOKING", "PARTIAL_AT_BOOKING", "PAY_AT_PICKUP"]), partial_payment_bps: z.number().int().min(0).max(10000),
      deposit_authorize_hours_before: z.number().int().min(0).max(168), late_return_grace_minutes: z.number().int().min(0).max(600),
      fuel_policy: z.enum(["FULL_TO_FULL", "SAME_TO_SAME", "PREPAID"]), fuel_charge_per_eighth_minor: z.number().int().min(0),
      dynamic_pricing_enabled: z.boolean(), price_floor_bps: z.number().int().min(0).max(10000), price_ceiling_bps: z.number().int().min(10000).max(100000),
    }).parse({
      reservation_buffer_minutes: num(fd, "buffer"), booking_mode: str(fd, "booking_mode"), requires_manual_approval: bool(fd, "manual_approval"),
      min_rental_minutes: (num(fd, "min_rental_hours") ?? 24) * 60, max_rental_days: num(fd, "max_rental_days"), min_lead_time_minutes: (num(fd, "lead_hours") ?? 0) * 60,
      hold_minutes: num(fd, "hold_minutes"), default_min_driver_age: num(fd, "min_age"), young_driver_age_below: num(fd, "young_age"),
      free_cancellation_hours: num(fd, "free_cancel_hours"), late_cancellation_fee_bps: pct("late_cancel_pct"), payment_timing: str(fd, "payment_timing"),
      partial_payment_bps: pct("partial_pct"), deposit_authorize_hours_before: num(fd, "deposit_hours"), late_return_grace_minutes: num(fd, "grace_minutes"),
      fuel_policy: str(fd, "fuel_policy"), fuel_charge_per_eighth_minor: money(fd, "fuel_charge") ?? 0, dynamic_pricing_enabled: bool(fd, "dynamic"),
      price_floor_bps: pct("floor_pct"), price_ceiling_bps: pct("ceiling_pct"),
    });
    check(await (await userClient()).from("tenant_settings").update(s).eq("tenant_id", ctx.tenantId));
  });
}

export async function saveTemplateAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "notifications.manage", async (ctx) => {
    const row = {
      tenant_id: ctx.tenantId, event: z.string().min(3).parse(str(fd, "event")), channel: z.enum(["EMAIL", "PUSH", "SMS", "IN_APP"]).parse(str(fd, "channel")),
      language: z.enum(["en", "sq"]).parse(str(fd, "language")), subject: str(fd, "subject"), body: z.string().min(1).max(5000).parse(str(fd, "body")), is_active: true,
    };
    const db = await userClient();
    const { data: existing } = await db.from("notification_templates").select("id").eq("tenant_id", ctx.tenantId).eq("event", row.event).eq("channel", row.channel).eq("language", row.language).maybeSingle();
    check(existing ? await db.from("notification_templates").update(row).eq("id", existing.id) : await db.from("notification_templates").insert(row));
  });
}
