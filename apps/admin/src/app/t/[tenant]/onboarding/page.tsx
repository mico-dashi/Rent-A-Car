import Link from "next/link";
import { ActionForm, Field, Hidden, Select, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { saveBrandAction } from "../branding/actions";
import { saveBranchAction } from "../branches/actions";
import { saveTaxAction } from "../pricing/actions";
import { connectPaymentsAction } from "../payments/actions";
import { saveRulesAction } from "../settings/actions";
import { advanceAction, saveAgreementTemplateAction } from "./actions";

const STEPS = ["business", "legal", "branding", "branches", "rules", "taxes", "payments", "vehicle", "pricing", "agreement", "launch"] as const;

export default async function OnboardingWizard({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ step?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "tenant.manage");
  const { t, lang } = await getT();
  const db = await userClient();
  const [{ data: s }, { data: b }, { count: branches }, { count: vehicles }, { count: taxes }, { data: acct }, { data: tpl }, { data: domains }] = await Promise.all([
    db.from("tenant_settings").select("*").eq("tenant_id", ctx.tenantId).single(),
    db.from("tenant_branding").select("*").eq("tenant_id", ctx.tenantId).single(),
    db.from("branches").select("*", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId),
    db.from("vehicles").select("*", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId),
    db.from("tax_rules").select("*", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId),
    db.from("tenant_payment_accounts").select("charges_enabled,provider_account_id").eq("tenant_id", ctx.tenantId).maybeSingle(),
    db.from("agreement_templates").select("body_md,version").eq("tenant_id", ctx.tenantId).eq("is_active", true).eq("language", lang).maybeSingle(),
    db.from("tenant_domains").select("hostname,is_primary").eq("tenant_id", ctx.tenantId),
  ]);
  const requested = Number((await searchParams).step);
  const step = Math.min(11, Math.max(2, Number.isFinite(requested) && requested >= 2 ? requested : (s?.onboarding_step ?? 2)));
  const data = (s?.onboarding_data ?? {}) as Record<string, string>;
  const done: Record<number, boolean> = { 1: true, 2: Boolean(data.registration_number), 3: Boolean(b?.logo_path || data.branding), 4: (branches ?? 0) > 0, 5: Boolean(data.rules), 6: (taxes ?? 0) > 0,
    7: Boolean(acct?.charges_enabled) || data.payments === "later", 8: (vehicles ?? 0) > 0, 9: Boolean(data.pricing), 10: Boolean(tpl), 11: Boolean(s?.onboarding_completed_at) };
  const progress = Math.round((Object.values(done).filter(Boolean).length / 11) * 100);
  const next = (extra?: React.ReactNode, label = t("admin.onboarding.saveContinue")) => (
    <ActionForm action={advanceAction} lang={lang} submitLabel={label} className="mt-4 space-y-3"><TenantFields slug={ctx.slug} /><Hidden name="step" value={step} />{extra}</ActionForm>
  );

  return (
    <>
      <PageHeader title={t("admin.onboarding.title")} subtitle={t("admin.onboarding.progress", { pct: progress })} />
      <div className="mb-6 h-1.5 rounded-full bg-raised" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-1.5 rounded-full bg-brand" style={{ width: `${progress}%` }} /></div>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <ol className="space-y-1 text-sm">{STEPS.map((k, i) => (
          <li key={k}>{i === 0 ? <span className="nav-link">✓ {t(`admin.onboarding.steps.${k}`)}</span> : (
            <Link href={`?step=${i + 1}`} aria-current={step === i + 1 ? "step" : undefined} className={`nav-link ${step === i + 1 ? "bg-raised text-fg" : ""}`}>{done[i + 1] ? "✓" : `${i + 1}.`} {t(`admin.onboarding.steps.${k}`)}</Link>)}</li>))}</ol>
        <Card title={`${t("admin.onboarding.step", { n: step, total: 11 })} — ${t(`admin.onboarding.steps.${STEPS[step - 1]}`)}`}>
          {step === 2 ? next(<div className="grid gap-4 md:grid-cols-2">
            <Field label={t("admin.onboarding.registrationNumber")} name="data_registration_number" required defaultValue={data.registration_number} />
            <Field label={t("admin.onboarding.vatNumber")} name="data_vat_number" defaultValue={data.vat_number} />
            <Field label={t("admin.customers.fields.address")} name="data_registered_address" defaultValue={data.registered_address} />
            <Field label={t("admin.onboarding.insurer")} name="data_insurer" defaultValue={data.insurer} /></div>) : null}
          {step === 3 && b ? (<>
            <ActionForm action={saveBrandAction} lang={lang} submitLabel={t("admin.common.save")}>
              <TenantFields slug={ctx.slug} />
              <div className="grid gap-4 md:grid-cols-3"><Field label={t("admin.branding.primary")} name="primary" type="color" defaultValue={b.primary_color} /><Field label={t("admin.branding.secondary")} name="secondary" type="color" defaultValue={b.secondary_color} /><Field label={t("admin.branding.background")} name="background" type="color" defaultValue={b.background_color} /></div>
              <Hidden name="font_heading" value={b.font_heading} /><Hidden name="font_body" value={b.font_body} /><Hidden name="theme" value={b.default_theme} /><Hidden name="email_from_name" value={b.email_from_name ?? ctx.name} />
            </ActionForm>
            <p className="mt-3 text-sm"><Link className="text-brand underline" href={`/t/${ctx.slug}/branding`}>{t("admin.onboarding.moreBranding")}</Link></p>
            {next(<Hidden name="data_branding" value="done" />)}</>) : null}
          {step === 4 ? (<>
            <p className="mb-3 text-sm text-muted">{t("admin.onboarding.branchesCount", { count: branches ?? 0 })}</p>
            <ActionForm action={saveBranchAction} lang={lang} submitLabel={t("admin.branches.add")} resetOnSuccess>
              <TenantFields slug={ctx.slug} /><Hidden name="is_active" value="on" /><Hidden name="timezone" value={ctx.timezone} />
              <div className="grid gap-4 md:grid-cols-2"><Field label={t("admin.common.name")} name="name" required /><Field label={t("admin.customers.fields.address")} name="address_line1" required /><Field label={t("admin.customers.fields.city")} name="city" required /><Field label={t("admin.customers.fields.country")} name="country_code" required pattern="[A-Za-z]{2}" /><Field label={t("admin.branches.airportCode")} name="airport_code" pattern="[A-Za-z]{3}" /></div>
              {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((dd) => <span key={dd}><Hidden name={`${dd}_open`} value="08:00" /><Hidden name={`${dd}_close`} value="20:00" /></span>)}
            </ActionForm>
            {(branches ?? 0) > 0 ? next() : null}</>) : null}
          {step === 5 && s ? (<>
            <ActionForm action={saveRulesAction} lang={lang} submitLabel={t("admin.common.save")}>
              <TenantFields slug={ctx.slug} />
              <div className="grid gap-4 md:grid-cols-3">
                <Select label={t("admin.settings.buffer")} name="buffer" required defaultValue={String(s.reservation_buffer_minutes)} options={[0, 30, 60, 120].map((m) => ({ value: String(m), label: `${m} min` }))} />
                <Field label={t("admin.settings.minAge")} name="min_age" type="number" required defaultValue={s.default_min_driver_age} />
                <Field label={t("admin.settings.freeCancelHours")} name="free_cancel_hours" type="number" required defaultValue={s.free_cancellation_hours} />
                <Field label={t("admin.settings.lateCancelPct")} name="late_cancel_pct" type="number" required defaultValue={s.late_cancellation_fee_bps / 100} />
                <Select label={t("admin.settings.paymentTiming")} name="payment_timing" required defaultValue={s.payment_timing} options={["FULL_AT_BOOKING", "PARTIAL_AT_BOOKING", "PAY_AT_PICKUP"].map((m) => ({ value: m, label: t(`admin.settings.timing.${m}`) }))} />
                <Select label={t("documents.fuel")} name="fuel_policy" required defaultValue={s.fuel_policy} options={["FULL_TO_FULL", "SAME_TO_SAME", "PREPAID"].map((m) => ({ value: m, label: t(`documents.fuelPolicy.${m}`) }))} />
              </div>
              {[["booking_mode", s.booking_mode], ["hold_minutes", s.hold_minutes], ["min_rental_hours", s.min_rental_minutes / 60], ["max_rental_days", s.max_rental_days], ["lead_hours", s.min_lead_time_minutes / 60], ["young_age", s.young_driver_age_below],
                ["partial_pct", s.partial_payment_bps / 100], ["deposit_hours", s.deposit_authorize_hours_before], ["grace_minutes", s.late_return_grace_minutes], ["fuel_charge", s.fuel_charge_per_eighth_minor / 100], ["floor_pct", s.price_floor_bps / 100], ["ceiling_pct", s.price_ceiling_bps / 100]]
                .map(([k, v]) => <Hidden key={String(k)} name={String(k)} value={String(v)} />)}
            </ActionForm>
            {next(<Hidden name="data_rules" value="done" />)}</>) : null}
          {step === 6 ? (<>
            <p className="mb-3 text-sm text-muted">{t("admin.onboarding.taxHint")}</p>
            <ActionForm action={saveTaxAction} lang={lang} submitLabel={t("admin.common.add")} resetOnSuccess>
              <TenantFields slug={ctx.slug} /><Hidden name="applies_to" value="RENTAL" /><Hidden name="applies_to" value="EXTRAS" /><Hidden name="applies_to" value="FEES" />
              <div className="grid gap-4 md:grid-cols-3"><Field label={t("admin.common.name")} name="name" required defaultValue="VAT" /><Field label={t("admin.pricing.ratePct")} name="ratePct" type="number" step="0.01" required /><Field label={t("admin.common.from")} name="effective_from" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
            </ActionForm>
            {next(undefined, (taxes ?? 0) > 0 ? t("admin.onboarding.saveContinue") : t("admin.onboarding.skip"))}</>) : null}
          {step === 7 ? (<>
            <p className="mb-3 text-sm">{acct?.charges_enabled ? `✓ ${t("admin.payments.chargesEnabled")}` : t("admin.onboarding.paymentsHint")}</p>
            {!acct?.charges_enabled ? <ActionForm action={connectPaymentsAction} lang={lang} submitLabel={t("admin.payments.connect")}><TenantFields slug={ctx.slug} /></ActionForm> : null}
            {next(<Hidden name="data_payments" value={acct?.charges_enabled ? "connected" : "later"} />, acct?.charges_enabled ? t("admin.onboarding.saveContinue") : t("admin.onboarding.later"))}</>) : null}
          {step === 8 ? (<><p className="text-sm">{t("admin.onboarding.vehiclesCount", { count: vehicles ?? 0 })}</p><Link className="btn-primary mt-3 inline-flex px-4 py-2 text-sm" href={`/t/${ctx.slug}/fleet/new`}>{t("admin.fleet.add")}</Link>{(vehicles ?? 0) > 0 ? next() : null}</>) : null}
          {step === 9 ? (<><p className="text-sm text-muted">{t("admin.onboarding.pricingHint")}</p><Link className="mt-2 inline-block text-sm text-brand underline" href={`/t/${ctx.slug}/pricing`}>{t("admin.nav.pricing")}</Link> · <Link className="text-sm text-brand underline" href={`/t/${ctx.slug}/extras`}>{t("admin.nav.extras")}</Link>{next(<Hidden name="data_pricing" value="done" />)}</>) : null}
          {step === 10 ? (<>
            <ActionForm action={saveAgreementTemplateAction} lang={lang} submitLabel={t("admin.common.save")}>
              <TenantFields slug={ctx.slug} /><Hidden name="language" value={lang} />
              <TextArea label={t("admin.onboarding.agreementBody")} name="body" rows={12} required defaultValue={tpl?.body_md ?? t("admin.onboarding.agreementDefault")} />
              <p className="text-xs text-muted">{t("admin.onboarding.agreementHint")}</p>
            </ActionForm>
            {tpl ? next() : null}</>) : null}
          {step === 11 ? (<>
            <ul className="space-y-1 text-sm">{STEPS.map((k, i) => <li key={k} className={done[i + 1] ? "text-ok" : "text-warn"}>{done[i + 1] ? "✓" : "○"} {t(`admin.onboarding.steps.${k}`)}</li>)}</ul>
            <p className="mt-3 text-sm">{t("admin.onboarding.launchHint", { host: (domains ?? []).find((d) => d.is_primary)?.hostname ?? "" })}</p>
            {next(undefined, t("admin.onboarding.launch"))}</>) : null}
        </Card>
      </div>
    </>
  );
}
