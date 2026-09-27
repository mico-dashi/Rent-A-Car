"use server";

import { redirect } from "next/navigation";
import type { Json } from "@rental/database";
import { z } from "@rental/validation";
import { check, num, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

/** Save a wizard step's data (merged into onboarding_data) and move on. Resumable at any time. */
export async function advanceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const step = num(fd, "step") ?? 2;
  const res = await tenantAction(fd, "tenant.manage", async (ctx) => {
    const db = await userClient();
    const { data: s } = await db.from("tenant_settings").select("onboarding_step,onboarding_data").eq("tenant_id", ctx.tenantId).single();
    const extra: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("data_") && typeof v === "string") extra[k.slice(5)] = v.slice(0, 500);
    const data = { ...((s?.onboarding_data ?? {}) as Record<string, Json>), ...extra } as Json;
    const next = Math.max(s?.onboarding_step ?? 1, Math.min(12, step + 1));
    check(await db.from("tenant_settings").update({ onboarding_step: next, onboarding_data: data, ...(step >= 11 ? { onboarding_completed_at: new Date().toISOString() } : {}) }).eq("tenant_id", ctx.tenantId));
  });
  if (res?.ok) redirect(step >= 11 ? `/t/${fd.get("_tenant")}` : `/t/${fd.get("_tenant")}/onboarding?step=${step + 1}`);
  return res;
}

export async function saveAgreementTemplateAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "agreements.manage", async (ctx) => {
    const db = await userClient();
    const language = z.enum(["en", "sq"]).parse(str(fd, "language"));
    const { data: last } = await db.from("agreement_templates").select("version").eq("tenant_id", ctx.tenantId).eq("language", language).order("version", { ascending: false }).limit(1).maybeSingle();
    check(await db.from("agreement_templates").update({ is_active: false }).eq("tenant_id", ctx.tenantId).eq("language", language));
    check(await db.from("agreement_templates").insert({ tenant_id: ctx.tenantId, language, version: (last?.version ?? 0) + 1, body_md: z.string().min(20).max(50000).parse(str(fd, "body")), is_active: true }));
  });
}
