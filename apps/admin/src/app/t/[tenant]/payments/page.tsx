import Link from "next/link";
import { ActionForm } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, Empty, PageHeader, Stat, Table } from "@/components/ui";
import { dt, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { connectPaymentsAction } from "./actions";

export default async function PaymentsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ status?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "payments.read");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const db = await userClient();
  let q = db.from("payments").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(200);
  if (sp.status) q = q.eq("status", sp.status);
  const [{ data: pays }, { data: refunds }, { data: acct }, { data: deposits }] = await Promise.all([
    q, db.from("refunds").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(50),
    db.from("tenant_payment_accounts").select("*").eq("tenant_id", ctx.tenantId).maybeSingle(),
    db.from("security_deposits").select("status,amount_minor").eq("tenant_id", ctx.tenantId).in("status", ["AUTHORIZED", "PENDING", "METHOD_SAVED", "FAILED"]),
  ]);
  const bIds = [...new Set((pays ?? []).map((p) => p.booking_id).filter(Boolean))] as string[];
  const { data: bks } = bIds.length ? await db.from("bookings").select("id,reference").in("id", bIds) : { data: [] };
  const bm = new Map((bks ?? []).map((b) => [b.id, b.reference]));
  const succeeded = (pays ?? []).filter((p) => p.status === "SUCCEEDED").reduce((a, p) => a + Number(p.amount_captured_minor), 0);
  const refunded = (refunds ?? []).filter((r) => r.status === "SUCCEEDED").reduce((a, r) => a + Number(r.amount_minor), 0);
  const held = (deposits ?? []).filter((d) => d.status === "AUTHORIZED").reduce((a, d) => a + Number(d.amount_minor), 0);
  return (
    <>
      <PageHeader title={t("admin.nav.payments")} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t("admin.payments.collected")} value={money(succeeded, ctx.currency, lang)} />
        <Stat label={t("admin.payments.refunded")} value={money(refunded, ctx.currency, lang)} />
        <Stat label={t("admin.payments.depositsHeld")} value={money(held, ctx.currency, lang)} />
        <Stat label={t("admin.payments.failed")} value={(pays ?? []).filter((p) => p.status === "FAILED").length} tone={(pays ?? []).some((p) => p.status === "FAILED") ? "bad" : undefined} />
      </div>
      <Card title={t("admin.payments.account")} className="mb-6">
        {acct?.provider_account_id ? (
          <p className="text-sm">Stripe · {acct.provider_account_id} · {acct.charges_enabled ? <Badge status="CONFIRMED">{t("admin.payments.chargesEnabled")}</Badge> : <Badge status="PENDING_APPROVAL">{t("admin.payments.onboardingIncomplete")}</Badge>} {acct.test_mode ? <Badge>test</Badge> : null}</p>
        ) : <p className="text-sm text-warn">{t("admin.payments.notConnected")}</p>}
        {can(ctx, "billing.manage") && !acct?.charges_enabled ? (
          <ActionForm action={connectPaymentsAction} lang={lang} submitLabel={acct?.provider_account_id ? t("admin.payments.continueOnboarding") : t("admin.payments.connect")} className="mt-3"><TenantFields slug={ctx.slug} /></ActionForm>
        ) : null}
      </Card>
      <Card>
        <form method="get" className="mb-4 flex gap-3"><select name="status" defaultValue={sp.status ?? ""} className="field py-2" aria-label={t("admin.common.status")}><option value="">{t("admin.common.all")}</option>{["REQUIRES_PAYMENT", "PROCESSING", "AUTHORIZED", "SUCCEEDED", "FAILED", "CANCELLED"].map((s) => <option key={s} value={s}>{t(`admin.payments.statuses.${s}`)}</option>)}</select><button className="btn-ghost px-4 py-2 text-sm">{t("admin.common.apply")}</button></form>
        {(pays ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
          <Table head={[t("admin.common.date"), t("admin.bookings.reference"), t("admin.payments.purpose"), t("admin.common.status"), t("admin.common.amount"), t("admin.payments.refunded"), t("admin.payments.fee")]}>
            {(pays ?? []).map((p) => (
              <tr key={p.id}><td className="whitespace-nowrap">{dt(p.created_at, ctx.timezone, lang)}</td>
                <td>{p.booking_id ? <Link className="text-brand hover:underline" href={`/t/${ctx.slug}/bookings/${p.booking_id}`}>{bm.get(p.booking_id) ?? "—"}</Link> : "—"}</td>
                <td>{t(`admin.payments.purposes.${p.purpose}`)}<span className="block text-xs text-muted">{p.provider}{p.is_test ? " · test" : ""}</span></td>
                <td><Badge status={p.status === "SUCCEEDED" ? "CONFIRMED" : p.status === "FAILED" ? "CANCELLED" : "PENDING_APPROVAL"}>{t(`admin.payments.statuses.${p.status}`)}</Badge>{p.failure_message ? <span className="block text-xs text-bad">{p.failure_message}</span> : null}</td>
                <td className="tabular-nums">{money(p.amount_minor, ctx.currency, lang)}</td><td className="tabular-nums">{money(p.amount_refunded_minor, ctx.currency, lang)}</td><td className="tabular-nums">{money(p.application_fee_minor, ctx.currency, lang)}</td></tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
