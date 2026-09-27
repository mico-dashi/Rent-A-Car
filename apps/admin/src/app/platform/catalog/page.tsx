import { ActionForm, Field, Hidden, Select, TextArea } from "@/components/forms";
import { Card, PageHeader, Table } from "@/components/ui";
import { d, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { userClient } from "@/lib/supabase/server";
import { saveAnnouncementAction, saveCouponAction, savePlatformSettingAction, setTenantFlagAction, toggleReferenceAction } from "../actions";

const GLOBAL_FLAGS = ["ai_damage_assist", "location_discovery", "phone_auth", "vehicle_delivery"];

export default async function CatalogPage() {
  const { t, lang } = await getT();
  const db = await userClient();
  const [{ data: currencies }, { data: languages }, { data: coupons }, { data: ann }, { data: flags }, { data: settings }] = await Promise.all([
    db.from("currencies").select("*").order("code"), db.from("languages").select("*").order("code"), db.from("coupons").select("*").order("created_at", { ascending: false }),
    db.from("platform_announcements").select("*").order("starts_at", { ascending: false }).limit(20), db.from("feature_flags").select("*").is("tenant_id", null), db.from("platform_settings").select("*").order("key"),
  ]);
  return (
    <>
      <PageHeader title={t("admin.platform.nav.catalog")} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={t("admin.platform.settings")}>
          {(settings ?? []).map((s) => (
            <ActionForm key={s.key} action={savePlatformSettingAction} lang={lang} submitLabel={t("admin.common.save")} variant="ghost" className="mb-3 flex flex-wrap items-end gap-2">
              <Hidden name="key" value={s.key} /><Field label={s.key} name="value" defaultValue={typeof s.value === "string" ? s.value : JSON.stringify(s.value)} />
            </ActionForm>))}
        </Card>
        <Card title={t("admin.platform.globalFlags")}>
          <Table head={[t("admin.platform.flag"), t("admin.common.status"), ""]}>
            {GLOBAL_FLAGS.map((f) => { const g = (flags ?? []).find((x) => x.key === f); return (
              <tr key={f}><td>{f}</td><td>{g?.enabled ? "✓" : "—"}</td><td><ActionForm action={setTenantFlagAction} lang={lang} submitLabel={g?.enabled ? t("admin.common.deactivate") : t("admin.common.activate")} variant="ghost" className="inline-flex"><Hidden name="key" value={f} /><Hidden name="value" value={g?.enabled ? "off" : "on"} /></ActionForm></td></tr>); })}
          </Table>
        </Card>
        <Card title={t("admin.platform.currenciesLanguages")}>
          <ul className="space-y-2 text-sm">{[...(currencies ?? []).map((c) => ({ table: "currencies", code: c.code, name: c.name, on: c.is_enabled })), ...(languages ?? []).map((l) => ({ table: "languages", code: l.code, name: l.name, on: l.is_enabled }))].map((r) => (
            <li key={r.table + r.code} className="flex items-center justify-between">{r.code} — {r.name}
              <ActionForm action={toggleReferenceAction} lang={lang} submitLabel={r.on ? t("admin.common.deactivate") : t("admin.common.activate")} variant="ghost" className="inline-flex"><Hidden name="table" value={r.table} /><Hidden name="code" value={r.code} /><Hidden name="enabled" value={r.on ? "0" : "1"} /></ActionForm></li>))}</ul>
        </Card>
        <Card title={t("admin.platform.coupons")}>
          <ul className="mb-4 space-y-1 text-sm">{(coupons ?? []).map((c) => <li key={c.id} className="font-mono">{c.code} · {c.percent_off_bps ? `${c.percent_off_bps / 100}%` : money(c.amount_off_minor, (c.currency ?? "EUR") as "EUR", lang)} · {c.redemptions}{c.max_redemptions ? `/${c.max_redemptions}` : ""}</li>)}</ul>
          <ActionForm action={saveCouponAction} lang={lang} submitLabel={t("admin.common.add")} variant="ghost" className="grid gap-3 md:grid-cols-3 md:items-end">
            <Field label={t("admin.pricing.code")} name="code" required /><Field label={t("admin.pricing.percentOff")} name="percent" type="number" step="0.01" /><Field label={t("admin.pricing.amountOff")} name="amount" />
            <Select label={t("admin.onboarding.currency")} name="currency" options={(currencies ?? []).map((c) => ({ value: c.code, label: c.code }))} /><Field label={t("admin.platform.months")} name="months" type="number" /><Field label={t("admin.pricing.maxRedemptions")} name="max" type="number" /><Field label={t("admin.common.to")} name="valid_until" type="date" />
          </ActionForm>
        </Card>
        <Card title={t("admin.platform.announcements")} className="xl:col-span-2">
          <ul className="mb-4 space-y-2 text-sm">{(ann ?? []).map((a) => <li key={a.id}><strong>{a.title}</strong> · {a.audience} · {d(a.starts_at, "UTC", lang)}{a.ends_at ? ` → ${d(a.ends_at, "UTC", lang)}` : ""}</li>)}</ul>
          <ActionForm action={saveAnnouncementAction} lang={lang} submitLabel={t("admin.common.add")} variant="ghost">
            <div className="grid gap-3 md:grid-cols-4"><Field label={t("admin.messages.subject")} name="title" required /><Select label={t("admin.platform.audience")} name="audience" required options={["ALL_TENANTS", "OWNERS", "ALL_USERS"].map((a) => ({ value: a, label: a }))} /><Field label={t("admin.common.from")} name="starts_at" type="date" /><Field label={t("admin.common.to")} name="ends_at" type="date" /></div>
            <TextArea label={t("admin.messages.message")} name="body" rows={3} required />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
