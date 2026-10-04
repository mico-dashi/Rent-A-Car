"use server";

import { revalidatePath } from "next/cache";
import { z } from "@rental/validation";
import { bool, check, failure, money, num, str, type ActionResult } from "@/lib/actions";
import { isPlatformAdmin } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

/** Every platform action re-checks admin status; RLS/RPCs enforce it again. */
async function admin(fn: () => Promise<void | ActionResult>): Promise<ActionResult> {
  try {
    if (!(await isPlatformAdmin())) return { ok: false, error: "FORBIDDEN" };
    const r = await fn();
    revalidatePath("/platform", "layout");
    return r ?? { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function setTenantStatusAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    check(await (await userClient()).rpc("admin_set_tenant_status", {
      p_tenant: str(fd, "tenantId"), p_status: z.enum(["PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "ARCHIVED"]).parse(str(fd, "status")), p_reason: str(fd, "reason"),
    }));
  });
}

export async function setSubscriptionAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    const db = await userClient();
    const tenantId = z.string().uuid().parse(str(fd, "tenantId"));
    const status = z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "LIFETIME"]).parse(str(fd, "status"));
    const interval = z.enum(["MONTHLY", "ANNUAL", "LIFETIME"]).parse(str(fd, "interval"));
    const commission = str(fd, "commission_kind");
    const row = {
      tenant_id: tenantId, plan_id: z.string().uuid().parse(str(fd, "planId")), status, interval,
      trial_ends_at: str(fd, "trial_ends_at") ? new Date(str(fd, "trial_ends_at")!).toISOString() : null,
      current_period_end: str(fd, "period_end") ? new Date(str(fd, "period_end")!).toISOString() : null,
      coupon_id: str(fd, "couponId"),
      commission_kind: commission ? z.enum(["NONE", "PERCENTAGE", "FIXED", "CUSTOM"]).parse(commission) : null,
      commission_bps: num(fd, "commission_pct") !== null ? Math.round(num(fd, "commission_pct")! * 100) : null,
      commission_fixed_minor: money(fd, "commission_fixed"),
    };
    const { data: live } = await db.from("tenant_subscriptions").select("id").eq("tenant_id", tenantId).in("status", ["TRIALING", "ACTIVE", "PAST_DUE", "LIFETIME"]).maybeSingle();
    check(live ? await db.from("tenant_subscriptions").update(row).eq("id", live.id) : await db.from("tenant_subscriptions").insert({ ...row, current_period_start: new Date().toISOString() }));
  });
}

export async function setTenantFlagAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    const db = await userClient();
    const key = z.string().regex(/^[a-z0-9_.]+$/).parse(str(fd, "key"));
    const tenantId = str(fd, "tenantId");
    const value = str(fd, "value");
    const q = db.from("feature_flags").delete().eq("key", key);
    check(tenantId ? await q.eq("tenant_id", tenantId) : await q.is("tenant_id", null));
    if (value === "on" || value === "off") check(await db.from("feature_flags").insert({ key, tenant_id: tenantId, enabled: value === "on" }));
  });
}

export async function verifyDomainAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    const status = z.enum(["VERIFIED", "FAILED", "PENDING_VERIFICATION"]).parse(str(fd, "status"));
    check(await (await userClient()).from("tenant_domains").update({ status, verified_at: status === "VERIFIED" ? new Date().toISOString() : null, last_checked_at: new Date().toISOString() }).eq("id", str(fd, "domainId")!));
  });
}

export async function savePlanAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    const features = Object.fromEntries(["custom_domain", "advanced_analytics", "api_access", "sms", "dedicated_app", "dynamic_pricing", "white_label_removal", "ai_damage_assist"].map((f) => [f, bool(fd, `f_${f}`)]));
    const lim = (k: string) => { const v = num(fd, k); return v === null || v < 0 ? null : v; };
    const row = {
      key: z.string().regex(/^[a-z0-9_]+$/).parse(str(fd, "key")), name: z.string().min(2).parse(str(fd, "name")),
      monthly_price_minor: money(fd, "monthly") ?? 0, annual_price_minor: money(fd, "annual") ?? 0, currency: z.string().length(3).parse(str(fd, "currency")),
      max_vehicles: lim("max_vehicles"), max_branches: lim("max_branches"), max_staff: lim("max_staff"), features,
      commission_kind: z.enum(["NONE", "PERCENTAGE", "FIXED", "CUSTOM"]).parse(str(fd, "commission_kind")),
      commission_bps: Math.round((num(fd, "commission_pct") ?? 0) * 100), commission_fixed_minor: money(fd, "commission_fixed") ?? 0,
      trial_days: num(fd, "trial_days") ?? 14, is_public: bool(fd, "is_public"), sort_order: num(fd, "sort_order") ?? 0,
    };
    const id = str(fd, "planId");
    const db = await userClient();
    check(id ? await db.from("subscription_plans").update(row).eq("id", id) : await db.from("subscription_plans").insert(row));
  });
}

export async function saveCouponAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    const pct = num(fd, "percent");
    const amount = money(fd, "amount");
    check(await (await userClient()).from("coupons").insert({
      code: z.string().regex(/^[A-Za-z0-9_-]{3,40}$/).parse(str(fd, "code"))!.toUpperCase(), percent_off_bps: pct !== null ? Math.round(pct * 100) : null,
      amount_off_minor: amount, currency: amount !== null ? str(fd, "currency") : null, duration_months: num(fd, "months"), max_redemptions: num(fd, "max"),
      valid_until: str(fd, "valid_until") ? new Date(str(fd, "valid_until")!).toISOString() : null,
    }));
  });
}

export async function saveAnnouncementAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    check(await (await userClient()).from("platform_announcements").insert({
      title: z.string().min(2).max(160).parse(str(fd, "title")), body: z.string().min(2).max(4000).parse(str(fd, "body")),
      audience: z.enum(["ALL_TENANTS", "OWNERS", "ALL_USERS"]).parse(str(fd, "audience")),
      starts_at: str(fd, "starts_at") ? new Date(str(fd, "starts_at")!).toISOString() : new Date().toISOString(), ends_at: str(fd, "ends_at") ? new Date(str(fd, "ends_at")!).toISOString() : null,
    }));
  });
}

export async function toggleReferenceAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    const table = z.enum(["currencies", "languages"]).parse(str(fd, "table"));
    check(await (await userClient()).from(table).update({ is_enabled: str(fd, "enabled") === "1" }).eq("code", str(fd, "code")!));
  });
}

export async function savePlatformSettingAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    const key = z.enum(["root_domain", "tenants_auto_approve", "max_tenants_per_user", "default_plan_key"]).parse(str(fd, "key"));
    const raw = str(fd, "value") ?? "";
    const value = key === "tenants_auto_approve" ? raw === "true" : key === "max_tenants_per_user" ? Number(raw) : raw;
    check(await (await userClient()).from("platform_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", key));
  });
}

export async function anonymizeAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    check(await (await userClient()).rpc("admin_anonymize_user", { p_user: str(fd, "userId"), p_request: str(fd, "requestId") }));
  });
}

export async function privacyStatusAction(_: ActionResult, fd: FormData) {
  return admin(async () => {
    check(await (await userClient()).from("privacy_requests").update({ status: z.enum(["IN_PROGRESS", "COMPLETED", "REJECTED"]).parse(str(fd, "status")), notes: str(fd, "notes") }).eq("id", str(fd, "requestId")!));
  });
}
