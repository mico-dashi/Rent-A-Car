import { ActionForm, Check, Field, Select, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, DL, PageHeader } from "@/components/ui";
import { d, toMajor } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { saveBusinessAction, saveRulesAction, saveTemplateAction } from "./actions";
import { MfaEnrollment } from "./mfa";

const EVENTS = ["booking.confirmed", "booking.cancelled", "payment.succeeded", "payment.failed", "pickup.reminder", "return.reminder", "rental.overdue", "deposit.updated", "staff.invited", "message.received"];

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "tenant.read");
  const { t, lang } = await getT();
  const ev = (e: string) => t(`admin.settings.events.${e.replace(".", "_")}`);
  const db = await userClient();
  const [{ data: tenant }, { data: s }, { data: sub }, { data: templates }, { data: counts }] = await Promise.all([
    db.from("tenants").select("*").eq("id", ctx.tenantId).single(),
    db.from("tenant_settings").select("*").eq("tenant_id", ctx.tenantId).single(),
    db.from("tenant_subscriptions").select("*, plan:subscription_plans(name,max_vehicles,max_branches,max_staff,features)").eq("tenant_id", ctx.tenantId).in("status", ["TRIALING", "ACTIVE", "PAST_DUE", "LIFETIME"]).maybeSingle(),
    db.from("notification_templates").select("*").or(`tenant_id.eq.${ctx.tenantId},tenant_id.is.null`).order("event"),
    db.rpc("tenant_features", { p_tenant: ctx.tenantId }),
  ]);
  if (!tenant || !s) return null;
  const edit = can(ctx, "tenant.manage");
  const plan = (sub?.plan ?? null) as { name: string; max_vehicles: number | null; max_branches: number | null; max_staff: number | null } | null;
  const features = (counts ?? {}) as Record<string, boolean>;
  return (
    <>
      <PageHeader title={t("admin.nav.settings")} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title={t("admin.settings.business")}>
            {edit ? (
              <ActionForm action={saveBusinessAction} lang={lang} submitLabel={t("admin.common.save")}>
                <TenantFields slug={ctx.slug} />
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t("admin.onboarding.displayName")} name="display_name" required defaultValue={tenant.display_name} />
                  <Field label={t("admin.onboarding.legalName")} name="legal_name" required defaultValue={tenant.legal_name} />
                  <Select label={t("admin.customers.fields.language")} name="default_language" required defaultValue={tenant.default_language} options={[{ value: "en", label: "English" }, { value: "sq", label: "Shqip" }]} />
                  <Field label={t("admin.branches.timezone")} name="timezone" required defaultValue={s.timezone} />
                </div>
                <p className="text-xs text-muted">{t("admin.settings.fixedFields", { country: tenant.country_code, currency: tenant.base_currency, code: tenant.tenant_code })}</p>
              </ActionForm>
            ) : <DL items={[[t("admin.onboarding.legalName"), tenant.legal_name], [t("admin.branches.timezone"), s.timezone]]} />}
          </Card>
          <Card title={t("admin.settings.rules")}>
            {edit ? (
              <ActionForm action={saveRulesAction} lang={lang} submitLabel={t("admin.common.save")}>
                <TenantFields slug={ctx.slug} />
                <fieldset className="grid gap-4 md:grid-cols-3"><legend className="label md:col-span-3">{t("admin.settings.availability")}</legend>
                  <Select label={t("admin.settings.buffer")} name="buffer" required defaultValue={String(s.reservation_buffer_minutes)} options={[0, 30, 60, 90, 120, 180, 240, 360].map((m) => ({ value: String(m), label: `${m} min` }))} />
                  <Select label={t("admin.settings.bookingMode")} name="booking_mode" required defaultValue={s.booking_mode} options={["EXACT_VEHICLE", "VEHICLE_CLASS"].map((m) => ({ value: m, label: t(`admin.bookingMode.${m}`) }))} />
                  <Field label={t("admin.settings.holdMinutes")} name="hold_minutes" type="number" min={5} max={120} required defaultValue={s.hold_minutes} />
                  <Field label={t("admin.settings.minRentalHours")} name="min_rental_hours" type="number" min={1} required defaultValue={Math.round(s.min_rental_minutes / 60)} />
                  <Field label={t("admin.settings.maxRentalDays")} name="max_rental_days" type="number" min={1} max={366} required defaultValue={s.max_rental_days} />
                  <Field label={t("admin.settings.leadHours")} name="lead_hours" type="number" min={0} required defaultValue={Math.round(s.min_lead_time_minutes / 60)} />
                </fieldset>
                <fieldset className="grid gap-4 md:grid-cols-3"><legend className="label md:col-span-3">{t("admin.settings.drivers")}</legend>
                  <Field label={t("admin.settings.minAge")} name="min_age" type="number" min={16} max={99} required defaultValue={s.default_min_driver_age} />
                  <Field label={t("admin.settings.youngAge")} name="young_age" type="number" min={16} max={99} required defaultValue={s.young_driver_age_below} />
                  <div className="flex items-end"><Check label={t("admin.settings.manualApproval")} name="manual_approval" defaultChecked={s.requires_manual_approval} /></div>
                </fieldset>
                <fieldset className="grid gap-4 md:grid-cols-3"><legend className="label md:col-span-3">{t("admin.settings.payments")}</legend>
                  <Select label={t("admin.settings.paymentTiming")} name="payment_timing" required defaultValue={s.payment_timing} options={["FULL_AT_BOOKING", "PARTIAL_AT_BOOKING", "PAY_AT_PICKUP"].map((m) => ({ value: m, label: t(`admin.settings.timing.${m}`) }))} />
                  <Field label={t("admin.settings.partialPct")} name="partial_pct" type="number" min={0} max={100} required defaultValue={s.partial_payment_bps / 100} />
                  <Field label={t("admin.settings.depositHours")} name="deposit_hours" type="number" min={0} max={168} required defaultValue={s.deposit_authorize_hours_before} />
                  <Field label={t("admin.settings.freeCancelHours")} name="free_cancel_hours" type="number" min={0} required defaultValue={s.free_cancellation_hours} />
                  <Field label={t("admin.settings.lateCancelPct")} name="late_cancel_pct" type="number" min={0} max={100} required defaultValue={s.late_cancellation_fee_bps / 100} />
                  <Field label={t("admin.settings.graceMinutes")} name="grace_minutes" type="number" min={0} required defaultValue={s.late_return_grace_minutes} />
                  <Select label={t("documents.fuel")} name="fuel_policy" required defaultValue={s.fuel_policy} options={["FULL_TO_FULL", "SAME_TO_SAME", "PREPAID"].map((m) => ({ value: m, label: t(`documents.fuelPolicy.${m}`) }))} />
                  <Field label={t("admin.settings.fuelCharge")} name="fuel_charge" defaultValue={toMajor(s.fuel_charge_per_eighth_minor)} />
                </fieldset>
                <fieldset className="grid gap-4 md:grid-cols-3"><legend className="label md:col-span-3">{t("admin.settings.dynamicPricing")}</legend>
                  <div className="flex items-end"><Check label={t("admin.settings.dynamicEnabled")} name="dynamic" defaultChecked={s.dynamic_pricing_enabled} /></div>
                  <Field label={t("admin.settings.floorPct")} name="floor_pct" type="number" min={0} max={100} required defaultValue={s.price_floor_bps / 100} />
                  <Field label={t("admin.settings.ceilingPct")} name="ceiling_pct" type="number" min={100} max={1000} required defaultValue={s.price_ceiling_bps / 100} />
                </fieldset>
              </ActionForm>
            ) : null}
          </Card>
          <Card title={t("admin.settings.templates")}>
            <p className="mb-3 text-xs text-muted">{t("admin.settings.templatesHint")}</p>
            <ul className="mb-4 space-y-1 text-sm">{(templates ?? []).map((tp) => <li key={tp.id}>{ev(tp.event)} · {tp.channel} · {tp.language} {tp.tenant_id ? <strong>({t("admin.settings.custom")})</strong> : <span className="text-muted">({t("admin.settings.default")})</span>}</li>)}</ul>
            {can(ctx, "notifications.manage") ? (
              <ActionForm action={saveTemplateAction} lang={lang} submitLabel={t("admin.common.save")} variant="ghost">
                <TenantFields slug={ctx.slug} />
                <div className="grid gap-3 md:grid-cols-3">
                  <Select label={t("admin.settings.event")} name="event" required options={EVENTS.map((e) => ({ value: e, label: ev(e) }))} />
                  <Select label={t("admin.settings.channel")} name="channel" required options={["EMAIL", "PUSH", "SMS", "IN_APP"].map((c) => ({ value: c, label: c }))} />
                  <Select label={t("admin.customers.fields.language")} name="language" required options={[{ value: "en", label: "English" }, { value: "sq", label: "Shqip" }]} />
                </div>
                <Field label={t("admin.messages.subject")} name="subject" />
                <TextArea label={t("admin.messages.message")} name="body" rows={4} required />
              </ActionForm>
            ) : null}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title={t("admin.settings.subscription")}>
            {sub ? <DL items={[[t("admin.settings.plan"), plan?.name ?? "—"], [t("admin.common.status"), sub.status], [t("admin.settings.renews"), d(sub.current_period_end, ctx.timezone, lang)],
              [t("admin.settings.limits"), `${plan?.max_vehicles ?? "∞"} / ${plan?.max_branches ?? "∞"} / ${plan?.max_staff ?? "∞"}`]]} /> : <p className="text-sm text-warn">{t("admin.settings.noSubscription")}</p>}
            <ul className="mt-3 flex flex-wrap gap-1 text-xs">{Object.entries(features).map(([k, v]) => <li key={k} className={`rounded-full border px-2 py-0.5 ${v ? "border-ok/40 text-ok" : "border-line text-muted"}`}>{k}</li>)}</ul>
            <p className="mt-3 text-xs text-muted">{t("admin.settings.planHint")}</p>
          </Card>
          <Card title={t("admin.settings.security")}><MfaEnrollment lang={lang} /></Card>
          <Card title={t("admin.settings.tenantCode")}><p className="font-mono text-2xl tracking-widest">{tenant.tenant_code}</p><p className="mt-1 text-xs text-muted">{t("admin.settings.tenantCodeHint")}</p></Card>
        </div>
      </div>
    </>
  );
}
