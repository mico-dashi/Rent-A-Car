import { VEHICLE_CATEGORIES } from "@rental/types";
import { ActionForm, Check, Field, Hidden, Select } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, Empty, PageHeader, Table } from "@/components/ui";
import { d, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { deleteRowAction, saveDiscountAction, saveRuleAction, saveSeasonAction, saveTaxAction, toggleDiscountAction } from "./actions";

const KINDS = ["WEEKEND_SURCHARGE", "AIRPORT_SURCHARGE", "DURATION_DISCOUNT", "YOUNG_DRIVER_FEE", "ADDITIONAL_DRIVER_FEE", "LEAD_TIME", "UTILIZATION"] as const;

export default async function PricingPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "pricing.read");
  const { t, lang } = await getT();
  const db = await userClient();
  const [{ data: rules }, { data: seasons }, { data: taxes }, { data: codes }, { data: settings }] = await Promise.all([
    db.from("pricing_rules").select("*").eq("tenant_id", ctx.tenantId).order("priority"),
    db.from("seasonal_rates").select("*").eq("tenant_id", ctx.tenantId).order("starts_on"),
    db.from("tax_rules").select("*").eq("tenant_id", ctx.tenantId).order("effective_from"),
    db.from("discount_codes").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }),
    db.from("tenant_settings").select("dynamic_pricing_enabled,price_floor_bps,price_ceiling_bps").eq("tenant_id", ctx.tenantId).single(),
  ]);
  const edit = can(ctx, "pricing.manage");
  const del = (table: string, id: string) => edit ? <ActionForm action={deleteRowAction} lang={lang} submitLabel="×" variant="danger" className="inline-flex" confirm={t("admin.common.confirmDelete")}><TenantFields slug={ctx.slug} /><Hidden name="table" value={table} /><Hidden name="id" value={id} /></ActionForm> : null;
  const describe = (r: NonNullable<typeof rules>[number]) => {
    const c = (r.condition ?? {}) as Record<string, unknown>;
    const amount = r.adjustment_bps !== null ? `${r.adjustment_bps > 0 ? "+" : ""}${r.adjustment_bps / 100}%` : money(r.amount_minor, ctx.currency, lang) + (r.per === "DAY" ? ` / ${t("common.perDay")}` : "");
    const cond = c.minDays ? `≥ ${c.minDays} ${t("admin.overview.days")}` : c.withinHours ? `≤ ${c.withinHours}h` : c.above !== undefined ? `> ${Number(c.above) * 100}%` : c.belowAge ? `< ${c.belowAge}` : Array.isArray(c.days) ? (c.days as number[]).map((x) => t(`admin.days.${["sun", "mon", "tue", "wed", "thu", "fri", "sat"][x]}`)).join(", ") : "";
    return `${amount}${cond ? ` · ${cond}` : ""}`;
  };

  return (
    <>
      <PageHeader title={t("admin.nav.pricing")} subtitle={settings?.dynamic_pricing_enabled ? t("admin.pricing.dynamicOn", { floor: settings.price_floor_bps / 100, ceiling: settings.price_ceiling_bps / 100 }) : t("admin.pricing.dynamicOff")} />
      <div className="space-y-6">
        <Card title={t("admin.pricing.rules")}>
          {(rules ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
            <Table head={[t("admin.common.name"), t("admin.common.type"), t("admin.pricing.effect"), t("admin.pricing.priority"), t("admin.common.status"), ""]}>
              {(rules ?? []).map((r) => <tr key={r.id}><td>{r.name}</td><td>{t(`admin.pricing.kinds.${r.kind}`)}{r.is_dynamic ? <Badge>{t("admin.pricing.dynamic")}</Badge> : null}</td><td>{describe(r)}</td><td>{r.priority}</td><td>{r.is_active ? t("admin.common.active") : t("admin.common.inactive")}</td><td>{del("pricing_rules", r.id)}</td></tr>)}
            </Table>
          )}
          {edit ? (
            <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">{t("admin.pricing.addRule")}</summary>
              <ActionForm action={saveRuleAction} lang={lang} submitLabel={t("admin.common.create")} className="mt-3 space-y-3">
                <TenantFields slug={ctx.slug} />
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label={t("admin.common.name")} name="name" required />
                  <Select label={t("admin.common.type")} name="kind" required options={KINDS.map((k) => ({ value: k, label: t(`admin.pricing.kinds.${k}`) }))} />
                  <Field label={t("admin.pricing.adjustmentPct")} name="adjustmentPct" type="number" step="0.01" hint={t("admin.pricing.adjustmentHint")} />
                  <Field label={t("admin.pricing.fixedAmount")} name="amount" />
                  <Select label={t("admin.pricing.per")} name="per" required options={[{ value: "BOOKING", label: t("admin.pricing.perBooking") }, { value: "DAY", label: t("common.perDay") }]} />
                  <Field label={t("admin.pricing.priority")} name="priority" type="number" defaultValue={100} />
                  <Field label={t("admin.pricing.minDays")} name="minDays" type="number" min={1} />
                  <Field label={t("admin.pricing.withinHours")} name="withinHours" type="number" min={1} />
                  <Field label={t("admin.pricing.utilizationAbove")} name="above" type="number" min={0} max={100} />
                  <Field label={t("admin.pricing.belowAge")} name="belowAge" type="number" min={16} max={99} />
                </div>
                <fieldset><legend className="label">{t("admin.pricing.weekendDays")}</legend><div className="flex flex-wrap gap-3 text-sm">{["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((dname, i) => <label key={dname} className="flex items-center gap-1"><input type="checkbox" name="days" value={i} defaultChecked={i === 5 || i === 6} />{t(`admin.days.${dname}`)}</label>)}</div></fieldset>
                <Check label={t("admin.common.active")} name="is_active" defaultChecked />
              </ActionForm>
            </details>
          ) : null}
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card title={t("admin.pricing.seasonal")}>
            {(seasons ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
              <Table head={[t("admin.common.name"), t("admin.common.from"), t("admin.common.to"), "%", ""]}>
                {(seasons ?? []).map((s) => <tr key={s.id}><td>{s.name}{s.category ? <span className="text-xs text-muted"> · {t(`category.${s.category}`)}</span> : null}</td><td>{d(s.starts_on, "UTC", lang)}</td><td>{d(s.ends_on, "UTC", lang)}</td><td>{s.adjustment_bps / 100}</td><td>{del("seasonal_rates", s.id)}</td></tr>)}
              </Table>
            )}
            {edit ? (
              <ActionForm action={saveSeasonAction} lang={lang} submitLabel={t("admin.common.add")} variant="ghost" className="mt-4 grid gap-3 md:grid-cols-3 md:items-end">
                <TenantFields slug={ctx.slug} />
                <Field label={t("admin.common.name")} name="name" required /><Field label={t("admin.common.from")} name="starts_on" type="date" required /><Field label={t("admin.common.to")} name="ends_on" type="date" required />
                <Field label={t("admin.pricing.adjustmentPct")} name="adjustmentPct" type="number" step="0.01" required />
                <Select label={t("admin.fleet.fields.category")} name="category" options={VEHICLE_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))} />
                <Field label={t("admin.pricing.priority")} name="priority" type="number" defaultValue={100} />
              </ActionForm>
            ) : null}
          </Card>

          <Card title={t("admin.pricing.taxes")}>
            {(taxes ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
              <Table head={[t("admin.common.name"), "%", t("admin.pricing.inclusive"), t("admin.common.from"), ""]}>
                {(taxes ?? []).map((x) => <tr key={x.id}><td>{x.name}<br /><span className="text-xs text-muted">{x.jurisdiction_label}</span></td><td>{x.rate_bps / 100}</td><td>{x.is_inclusive ? "✓" : "—"}</td><td>{d(x.effective_from, "UTC", lang)}{x.effective_to ? ` → ${d(x.effective_to, "UTC", lang)}` : ""}</td><td>{del("tax_rules", x.id)}</td></tr>)}
              </Table>
            )}
            {edit ? (
              <ActionForm action={saveTaxAction} lang={lang} submitLabel={t("admin.common.add")} variant="ghost" className="mt-4 space-y-3">
                <TenantFields slug={ctx.slug} />
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label={t("admin.common.name")} name="name" required /><Field label={t("admin.pricing.ratePct")} name="ratePct" type="number" step="0.01" required />
                  <Field label={t("admin.pricing.jurisdiction")} name="jurisdiction" /><Field label={t("admin.common.from")} name="effective_from" type="date" required /><Field label={t("admin.common.to")} name="effective_to" type="date" />
                </div>
                <div className="flex flex-wrap gap-4 text-sm">{["RENTAL", "EXTRAS", "FEES"].map((a) => <label key={a} className="flex items-center gap-1"><input type="checkbox" name="applies_to" value={a} defaultChecked />{t(`admin.pricing.appliesTo.${a}`)}</label>)}</div>
                <Check label={t("admin.pricing.inclusiveHint")} name="is_inclusive" />
              </ActionForm>
            ) : null}
          </Card>
        </div>

        <Card title={t("admin.pricing.discounts")}>
          {(codes ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
            <Table head={[t("admin.pricing.code"), t("admin.pricing.value"), t("admin.pricing.used"), t("admin.common.to"), t("admin.common.status"), ""]}>
              {(codes ?? []).map((c) => <tr key={c.id}><td className="font-mono">{c.code}</td><td>{c.percent_off_bps ? `${c.percent_off_bps / 100}%` : money(c.amount_off_minor, ctx.currency, lang)}{c.min_rental_days ? ` · ≥${c.min_rental_days}d` : ""}</td>
                <td>{c.redemptions}{c.max_redemptions ? ` / ${c.max_redemptions}` : ""}</td><td>{c.valid_until ? d(c.valid_until, ctx.timezone, lang) : "—"}</td>
                <td>{edit ? <ActionForm action={toggleDiscountAction} lang={lang} submitLabel={c.is_active ? t("admin.common.deactivate") : t("admin.common.activate")} variant="ghost" className="inline-flex"><TenantFields slug={ctx.slug} /><Hidden name="id" value={c.id} /><Hidden name="active" value={c.is_active ? "0" : "1"} /></ActionForm> : c.is_active ? t("admin.common.active") : t("admin.common.inactive")}</td>
                <td>{del("discount_codes", c.id)}</td></tr>)}
            </Table>
          )}
          {edit ? (
            <ActionForm action={saveDiscountAction} lang={lang} submitLabel={t("admin.common.add")} variant="ghost" className="mt-4 grid gap-3 md:grid-cols-4 md:items-end">
              <TenantFields slug={ctx.slug} />
              <Field label={t("admin.pricing.code")} name="code" required pattern="[A-Za-z0-9_-]{3,40}" /><Field label={t("admin.pricing.percentOff")} name="percent" type="number" step="0.01" /><Field label={t("admin.pricing.amountOff")} name="amount" />
              <Field label={t("admin.pricing.minDays")} name="min_days" type="number" min={1} /><Field label={t("admin.common.from")} name="valid_from" type="date" /><Field label={t("admin.common.to")} name="valid_until" type="date" />
              <Field label={t("admin.pricing.maxRedemptions")} name="max_redemptions" type="number" min={1} />
            </ActionForm>
          ) : null}
        </Card>
      </div>
    </>
  );
}
