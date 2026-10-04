import { ActionForm, Check, Field, Hidden, Select, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader, Table } from "@/components/ui";
import { money, toMajor } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import type { Tables } from "@rental/database";
import { saveBranchAction, saveOneWayAction } from "./actions";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export default async function BranchesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "branches.read");
  const { t, lang } = await getT();
  const db = await userClient();
  const [{ data: branches }, { data: fees }] = await Promise.all([
    db.from("branches").select("*").eq("tenant_id", ctx.tenantId).order("name"),
    db.from("one_way_fees").select("*").eq("tenant_id", ctx.tenantId),
  ]);
  const edit = can(ctx, "branches.write");
  const form = (b?: Tables<"branches">) => {
    const hours = (b?.opening_hours ?? {}) as Record<string, { open: string; close: string }[]>;
    return (
      <ActionForm action={saveBranchAction} lang={lang} submitLabel={b ? t("admin.common.save") : t("admin.common.create")} variant={b ? "ghost" : "primary"}>
        <TenantFields slug={ctx.slug} />{b ? <Hidden name="branchId" value={b.id} /> : null}
        <div className="grid gap-3 md:grid-cols-4">
          <Field label={t("admin.common.name")} name="name" required defaultValue={b?.name} />
          <Field label={t("admin.customers.fields.address")} name="address_line1" required defaultValue={b?.address_line1} />
          <Field label={t("admin.customers.fields.city")} name="city" required defaultValue={b?.city} />
          <Field label={t("admin.customers.fields.country")} name="country_code" required defaultValue={b?.country_code} pattern="[A-Za-z]{2}" />
          <Field label={t("admin.customers.fields.postalCode")} name="postal_code" defaultValue={b?.postal_code} />
          <Field label={t("admin.branches.timezone")} name="timezone" required defaultValue={b?.timezone ?? ctx.timezone} />
          <Field label={t("admin.branches.latitude")} name="latitude" type="number" step="0.000001" defaultValue={b?.latitude} />
          <Field label={t("admin.branches.longitude")} name="longitude" type="number" step="0.000001" defaultValue={b?.longitude} />
          <Field label={t("admin.customers.fields.phone")} name="phone" defaultValue={b?.phone} />
          <Field label={t("auth.email")} name="email" type="email" defaultValue={b?.email} />
          <Field label={t("admin.branches.airportCode")} name="airport_code" defaultValue={b?.airport_code} pattern="[A-Za-z]{3}" hint={t("admin.branches.airportHint")} />
        </div>
        <fieldset><legend className="label">{t("admin.branches.hours")}</legend>
          <div className="grid gap-2 md:grid-cols-7">{DAYS.map((d) => (
            <div key={d} className="space-y-1 text-xs"><p className="font-semibold uppercase">{t(`admin.days.${d}`)}</p>
              <input name={`${d}_open`} type="time" defaultValue={hours[d]?.[0]?.open ?? "08:00"} aria-label={`${d} open`} className="field py-1.5" />
              <input name={`${d}_close`} type="time" defaultValue={hours[d]?.[0]?.close ?? "20:00"} aria-label={`${d} close`} className="field py-1.5" />
              <label className="flex items-center gap-1"><input type="checkbox" name={`${d}_closed`} defaultChecked={b ? (hours[d] ?? []).length === 0 : d === "sun"} />{t("admin.branches.closed")}</label>
            </div>))}</div>
        </fieldset>
        <TextArea label={t("admin.branches.instructions")} name="pickup_instructions" defaultValue={b?.pickup_instructions} rows={2} />
        <Check label={t("admin.common.active")} name="is_active" defaultChecked={b?.is_active ?? true} />
      </ActionForm>
    );
  };
  const bn = (id: string) => (branches ?? []).find((b) => b.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader title={t("admin.nav.branches")} />
      <div className="space-y-6">
        {(branches ?? []).map((b) => <Card key={b.id} title={`${b.name}${b.airport_code ? ` (${b.airport_code})` : ""}${b.is_active ? "" : ` — ${t("admin.common.inactive")}`}`}>{edit ? form(b) : <p className="text-sm">{b.address_line1}, {b.city}</p>}</Card>)}
        {edit ? <Card title={t("admin.branches.add")}>{form()}</Card> : null}
        {(branches ?? []).length > 1 ? (
          <Card title={t("admin.branches.oneWay")}>
            {(fees ?? []).length ? <Table head={[t("admin.common.from"), t("admin.common.to"), t("admin.common.amount"), t("admin.common.status")]}>
              {(fees ?? []).map((f) => <tr key={`${f.from_branch_id}${f.to_branch_id}`}><td>{bn(f.from_branch_id)}</td><td>{bn(f.to_branch_id)}</td><td>{money(f.fee_minor, ctx.currency, lang)}</td><td>{f.allowed ? t("admin.common.allowed") : t("admin.common.notAllowed")}</td></tr>)}
            </Table> : null}
            {can(ctx, "pricing.manage") ? (
              <ActionForm action={saveOneWayAction} lang={lang} submitLabel={t("admin.common.save")} variant="ghost" className="mt-4 grid gap-3 md:grid-cols-5 md:items-end">
                <TenantFields slug={ctx.slug} />
                <Select label={t("admin.common.from")} name="from" required options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
                <Select label={t("admin.common.to")} name="to" required options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
                <Field label={t("admin.common.amount")} name="fee" required defaultValue={toMajor(0)} />
                <Select label={t("admin.common.status")} name="allowed" required options={[{ value: "on", label: t("admin.common.allowed") }, { value: "off", label: t("admin.common.notAllowed") }]} />
              </ActionForm>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
