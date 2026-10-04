"use server";

import { redirect } from "next/navigation";
import { check, tenantAction, type ActionResult } from "@/lib/actions";
import { provider } from "@/lib/providers";
import { serviceClient } from "@/lib/supabase/server";

/** Stripe Connect Express onboarding for the tenant (billing.manage). */
export async function connectPaymentsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let url: string | null = null;
  const res = await tenantAction(fd, "billing.manage", async (ctx) => {
    const p = provider();
    if (!p) throw new Error("PAYMENTS_NOT_CONFIGURED");
    const db = serviceClient();
    const { data: acct } = await db.from("tenant_payment_accounts").select("*").eq("tenant_id", ctx.tenantId).maybeSingle();
    let accountId = acct?.provider_account_id ?? null;
    if (!accountId) {
      const { data: t } = await db.from("tenants").select("country_code,legal_name").eq("id", ctx.tenantId).single();
      accountId = (await p.createConnectedAccount({ email: ctx.email ?? "", country: t!.country_code, businessName: t!.legal_name, idempotencyKey: `connect:${ctx.tenantId}`, metadata: { tenantId: ctx.tenantId } })).accountId;
      check(await db.from("tenant_payment_accounts").upsert({ tenant_id: ctx.tenantId, provider: "stripe", provider_account_id: accountId, test_mode: p.mode === "test" }, { onConflict: "tenant_id" }));
    }
    const base = process.env.NEXT_PUBLIC_ADMIN_URL ?? "";
    url = (await p.createAccountLink({ accountId, refreshUrl: `${base}/t/${ctx.slug}/payments`, returnUrl: `${base}/t/${ctx.slug}/payments?connected=1` })).url;
  });
  if (res?.ok && url) redirect(url);
  return res;
}
