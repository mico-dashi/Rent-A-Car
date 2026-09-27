import type { Tables } from "@rental/database";
import { ActionForm, Check, Field, Hidden, Select } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { money, toMajor } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { userClient } from "@/lib/supabase/server";
import { savePlanAction } from "../actions";

const FEATURES = ["custom_domain", "advanced_analytics", "api_access", "sms", "dedicated_app", "dynamic_pricing", "white_label_removal", "ai_damage_assist"];

export default async function PlansPage() {
  const { t, lang } = await getT();
  const { data: plans } = await (await userClient()).from("subscription_plans").select("*").order("sort_order");
  const form = (p?: Tables<"subscription_plans">) => {
    const f = (p?.features ?? {}) as Record<string, boolean>;
    return (
      <ActionForm action={savePlanAction} lang={lang} submitLabel={p ? t("admin.common.save") : t("admin.common.create")} variant={p ? "ghost" : "primary"}>
        {p ? <Hidden name="planId" value={p.id} /> : null}
        <div className="grid gap-3 md:grid-cols-4">
          <Field label={t("admin.pricing.code")} name="key" required defaultValue={p?.key} /><Field label={t("admin.common.name")} name="name" required defaultValue={p?.name} />
          <Field label={t("admin.platform.monthly")} name="monthly" defaultValue={toMajor(p?.monthly_price_minor ?? 0)} /><Field label={t("admin.platform.annual")} name="annual" defaultValue={toMajor(p?.annual_price_minor ?? 0)} />
          <Field label={t("admin.onboarding.currency")} name="currency" required defaultValue={p?.currency ?? "EUR"} />
          <Field label={t("admin.platform.maxVehicles")} name="max_vehicles" type="number" defaultValue={p?.max_vehicles ?? -1} hint={t("admin.platform.unlimitedHint")} />
          <Field label={t("admin.platform.maxBranches")} name="max_branches" type="number" defaultValue={p?.max_branches ?? -1} />
          <Field label={t("admin.platform.maxStaff")} name="max_staff" type="number" defaultValue={p?.max_staff ?? -1} />
          <Select label={t("admin.platform.commissionOverride")} name="commission_kind" required defaultValue={p?.commission_kind ?? "NONE"} options={["NONE", "PERCENTAGE", "FIXED", "CUSTOM"].map((k) => ({ value: k, label: t(`admin.platform.commission.${k}`) }))} />
          <Field label={t("admin.platform.commissionPct")} name="commission_pct" type="number" step="0.01" defaultValue={(p?.commission_bps ?? 0) / 100} />
          <Field label={t("admin.platform.commissionFixed")} name="commission_fixed" defaultValue={toMajor(p?.commission_fixed_minor ?? 0)} />
          <Field label={t("admin.platform.trialDays")} name="trial_days" type="number" defaultValue={p?.trial_days ?? 14} />
          <Field label={t("admin.extras.sort")} name="sort_order" type="number" defaultValue={p?.sort_order ?? 0} />
        </div>
        <div className="flex flex-wrap gap-4">{FEATURES.map((x) => <Check key={x} name={`f_${x}`} label={x} defaultChecked={f[x]} />)}<Check name="is_public" label={t("admin.platform.public")} defaultChecked={p?.is_public ?? true} /></div>
      </ActionForm>
    );
  };
  return (
    <>
      <PageHeader title={t("admin.platform.nav.plans")} />
      <div className="space-y-4">
        {(plans ?? []).map((p) => <Card key={p.id} title={`${p.name} — ${money(p.monthly_price_minor, p.currency as "EUR", lang)} / ${money(p.annual_price_minor, p.currency as "EUR", lang)}`}>{form(p)}</Card>)}
        <Card title={t("admin.platform.newPlan")}>{form()}</Card>
      </div>
    </>
  );
}
