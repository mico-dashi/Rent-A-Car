import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, Hidden, Select } from "@/components/forms";
import { Badge, Card, DL, PageHeader, Table } from "@/components/ui";
import { d, dt, toMajor } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { userClient } from "@/lib/supabase/server";
import { setSubscriptionAction, setTenantFlagAction, setTenantStatusAction, verifyDomainAction } from "../../actions";

const FLAGS = ["custom_domain", "advanced_analytics", "api_access", "sms", "dedicated_app", "dynamic_pricing", "white_label_removal", "ai_damage_assist", "location_discovery", "vehicle_delivery"];

export default async function TenantAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, lang } = await getT();
  const db = await userClient();
  const { data: tn } = await db.from("tenants").select("*").eq("id", id).maybeSingle();
  if (!tn) notFound();
  const [{ data: sub }, { data: plans }, { data: flags }, { data: domains }, { data: coupons }, { data: features }, { count: vehicles }, { count: members }] = await Promise.all([
    db.from("tenant_subscriptions").select("*").eq("tenant_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("subscription_plans").select("id,name,key").order("sort_order"),
    db.from("feature_flags").select("*").eq("tenant_id", id),
    db.from("tenant_domains").select("*").eq("tenant_id", id),
    db.from("coupons").select("id,code"),
    db.rpc("tenant_features", { p_tenant: id }),
    db.from("vehicles").select("*", { count: "exact", head: true }).eq("tenant_id", id),
    db.from("memberships").select("*", { count: "exact", head: true }).eq("tenant_id", id),
  ]);
  const eff = (features ?? {}) as Record<string, boolean>;
  const transitions: Record<string, string[]> = { PENDING_APPROVAL: ["ACTIVE", "ARCHIVED"], ACTIVE: ["SUSPENDED", "ARCHIVED"], SUSPENDED: ["ACTIVE", "ARCHIVED"], ARCHIVED: ["ACTIVE"] };
  return (
    <>
      <PageHeader title={tn.display_name} subtitle={`${tn.legal_name} · ${tn.slug} · ${tn.tenant_code}`} actions={<><Badge>{t(`admin.tenantStatus.${tn.status}`)}</Badge><Link className="btn-ghost px-4 py-2 text-sm" href={`/t/${tn.slug}`}>{t("admin.platform.openDashboard")}</Link></>} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={t("admin.platform.lifecycle")}>
          <DL items={[[t("admin.customers.fields.country"), tn.country_code], [t("admin.onboarding.currency"), tn.base_currency], [t("admin.common.date"), d(tn.created_at, "UTC", lang)], [t("admin.nav.fleet"), vehicles ?? 0], [t("admin.nav.employees"), members ?? 0], [t("admin.common.reason"), tn.suspended_reason]]} />
          <div className="mt-4 space-y-3">{(transitions[tn.status] ?? []).map((s) => (
            <ActionForm key={s} action={setTenantStatusAction} lang={lang} submitLabel={t(`admin.platform.to.${s}`)} variant={s === "ACTIVE" ? "primary" : "danger"} confirm={t("admin.common.confirm")} className="flex flex-wrap items-end gap-2">
              <Hidden name="tenantId" value={tn.id} /><Hidden name="status" value={s} />{s === "SUSPENDED" ? <input name="reason" required placeholder={t("admin.common.reason")} aria-label={t("admin.common.reason")} className="field w-64 py-2" /> : null}
            </ActionForm>))}</div>
        </Card>
        <Card title={t("admin.settings.subscription")}>
          <ActionForm action={setSubscriptionAction} lang={lang} submitLabel={t("admin.common.save")}>
            <Hidden name="tenantId" value={tn.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <Select label={t("admin.settings.plan")} name="planId" required defaultValue={sub?.plan_id} options={(plans ?? []).map((p) => ({ value: p.id, label: p.name }))} />
              <Select label={t("admin.common.status")} name="status" required defaultValue={sub?.status ?? "TRIALING"} options={["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "LIFETIME"].map((s) => ({ value: s, label: s }))} />
              <Select label={t("admin.platform.interval")} name="interval" required defaultValue={sub?.interval ?? "MONTHLY"} options={["MONTHLY", "ANNUAL", "LIFETIME"].map((s) => ({ value: s, label: s }))} />
              <Field label={t("admin.platform.trialEnds")} name="trial_ends_at" type="date" defaultValue={sub?.trial_ends_at?.slice(0, 10)} />
              <Field label={t("admin.settings.renews")} name="period_end" type="date" defaultValue={sub?.current_period_end?.slice(0, 10)} />
              <Select label={t("admin.platform.coupon")} name="couponId" defaultValue={sub?.coupon_id} options={(coupons ?? []).map((c) => ({ value: c.id, label: c.code }))} />
              <Select label={t("admin.platform.commissionOverride")} name="commission_kind" defaultValue={sub?.commission_kind} options={["NONE", "PERCENTAGE", "FIXED", "CUSTOM"].map((k) => ({ value: k, label: t(`admin.platform.commission.${k}`) }))} />
              <Field label={t("admin.platform.commissionPct")} name="commission_pct" type="number" step="0.01" defaultValue={sub?.commission_bps !== null && sub?.commission_bps !== undefined ? sub.commission_bps / 100 : undefined} />
              <Field label={t("admin.platform.commissionFixed")} name="commission_fixed" defaultValue={toMajor(sub?.commission_fixed_minor)} />
            </div>
          </ActionForm>
        </Card>
        <Card title={t("admin.platform.features")}>
          <Table head={[t("admin.platform.flag"), t("admin.platform.effective"), t("admin.platform.override")]}>
            {FLAGS.map((f) => {
              const o = (flags ?? []).find((x) => x.key === f);
              return (<tr key={f}><td>{f}</td><td>{eff[f] ? "✓" : "—"}</td><td>
                <ActionForm action={setTenantFlagAction} lang={lang} submitLabel={t("admin.common.save")} variant="ghost" className="flex items-center gap-2"><Hidden name="tenantId" value={tn.id} /><Hidden name="key" value={f} />
                  <select name="value" defaultValue={o ? (o.enabled ? "on" : "off") : ""} className="field w-28 py-1.5 text-xs" aria-label={f}><option value="">{t("admin.platform.inherit")}</option><option value="on">{t("admin.platform.forceOn")}</option><option value="off">{t("admin.platform.forceOff")}</option></select>
                </ActionForm></td></tr>);
            })}
          </Table>
        </Card>
        <Card title={t("admin.website.domains")}>
          <ul className="space-y-3 text-sm">{(domains ?? []).map((dm) => (
            <li key={dm.id} className="flex flex-wrap items-center gap-2">{dm.hostname} <Badge>{t(`admin.website.domainStatus.${dm.status}`)}</Badge>{dm.last_checked_at ? <span className="text-xs text-muted">{dt(dm.last_checked_at, "UTC", lang)}</span> : null}
              {!dm.is_platform_subdomain && dm.status !== "VERIFIED" ? <ActionForm action={verifyDomainAction} lang={lang} submitLabel={t("admin.platform.markVerified")} variant="ghost" className="inline-flex" confirm={t("admin.platform.verifyConfirm")}><Hidden name="domainId" value={dm.id} /><Hidden name="status" value="VERIFIED" /></ActionForm> : null}</li>))}</ul>
        </Card>
      </div>
    </>
  );
}
