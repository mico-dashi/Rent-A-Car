import { ActionForm, Field, Select } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, Empty, LinkButton, PageHeader, Table } from "@/components/ui";
import { d, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { addExpenseAction } from "./actions";

const CATS = ["MAINTENANCE", "REPAIR", "INSURANCE", "REGISTRATION", "CLEANING", "FUEL", "PARKING", "TOLL", "OTHER"];

export default async function ExpensesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "expenses.read");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const db = await userClient();
  let q = db.from("expenses").select("*").eq("tenant_id", ctx.tenantId).order("incurred_on", { ascending: false }).limit(300);
  if (sp.from) q = q.gte("incurred_on", sp.from);
  if (sp.to) q = q.lte("incurred_on", sp.to);
  const [{ data: rows }, { data: vehicles }, { data: branches }] = await Promise.all([q,
    db.from("vehicles").select("id,make,model,registration_plate").eq("tenant_id", ctx.tenantId), db.from("branches").select("id,name").eq("tenant_id", ctx.tenantId)]);
  const vm = new Map((vehicles ?? []).map((v) => [v.id, `${v.make} ${v.model} · ${v.registration_plate}`]));
  const total = (rows ?? []).reduce((a, r) => a + Number(r.amount_minor), 0);
  const qs = new URLSearchParams({ kind: "expenses", ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) });
  return (
    <>
      <PageHeader title={t("admin.nav.expenses")} subtitle={`${t("common.total")}: ${money(total, ctx.currency, lang)}`}
        actions={can(ctx, "reports.read") ? <LinkButton variant="ghost" href={`/t/${ctx.slug}/reports/export?${qs}`}>CSV</LinkButton> : null} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3"><Field label={t("admin.common.from")} name="from" type="date" defaultValue={sp.from} /><Field label={t("admin.common.to")} name="to" type="date" defaultValue={sp.to} /><button className="btn-ghost px-4 py-2 text-sm">{t("admin.common.apply")}</button></form>
          {(rows ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
            <Table head={[t("admin.common.date"), t("admin.expenses.category"), t("admin.customers.fields.description"), t("admin.bookings.vehicle"), t("admin.common.amount"), ""]}>
              {(rows ?? []).map((r) => <tr key={r.id}><td className="whitespace-nowrap">{d(r.incurred_on, "UTC", lang)}</td><td>{t(`admin.expenses.categories.${r.category}`)}</td><td>{r.description}{r.vendor ? <span className="block text-xs text-muted">{r.vendor}</span> : null}</td>
                <td>{r.vehicle_id ? vm.get(r.vehicle_id) : "—"}</td><td className="tabular-nums">{money(r.amount_minor, ctx.currency, lang)}</td>
                <td>{r.receipt_path ? <a className="text-brand underline" href={`/t/${ctx.slug}/documents?bucket=vehicle-documents&path=${encodeURIComponent(r.receipt_path)}`}>{t("admin.expenses.receipt")}</a> : null}</td></tr>)}
            </Table>
          )}
        </Card>
        {can(ctx, "expenses.manage") ? (
          <Card title={t("admin.expenses.add")}>
            <ActionForm action={addExpenseAction} lang={lang} submitLabel={t("admin.common.add")} resetOnSuccess>
              <TenantFields slug={ctx.slug} />
              <Select label={t("admin.expenses.category")} name="category" required options={CATS.map((c) => ({ value: c, label: t(`admin.expenses.categories.${c}`) }))} />
              <Field label={t("admin.customers.fields.description")} name="description" required />
              <Field label={t("admin.common.amount")} name="amount" required /><Field label={t("documents.tax")} name="tax" />
              <Field label={t("admin.common.date")} name="incurred_on" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
              <Select label={t("admin.bookings.vehicle")} name="vehicleId" options={(vehicles ?? []).map((v) => ({ value: v.id, label: `${v.make} ${v.model} · ${v.registration_plate}` }))} />
              <Select label={t("admin.nav.branches")} name="branchId" options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
              <Field label={t("admin.expenses.vendor")} name="vendor" /><Field label={t("admin.expenses.externalRef")} name="external_ref" hint={t("admin.expenses.externalRefHint")} />
              <input type="file" name="receipt" accept="application/pdf,image/jpeg,image/png" aria-label={t("admin.expenses.receipt")} className="text-sm" />
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
