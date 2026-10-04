import Link from "next/link";
import { ActionForm, Field, Hidden, Select, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, Empty, PageHeader, Table } from "@/components/ui";
import { dt, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { scheduleMaintenanceAction, updateMaintenanceAction } from "./actions";

const TYPES = ["OIL", "TIRES", "BRAKES", "REPAIR", "INSPECTION", "CLEANING", "CUSTOM"];

export default async function MaintenancePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ vehicle?: string; status?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "maintenance.read");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const db = await userClient();
  let q = db.from("maintenance_records").select("*").eq("tenant_id", ctx.tenantId).order("scheduled_start", { ascending: false }).limit(200);
  if (sp.vehicle) q = q.eq("vehicle_id", sp.vehicle);
  if (sp.status) q = q.eq("status", sp.status);
  const [{ data: rows }, { data: vehicles }] = await Promise.all([q, db.from("vehicles").select("id,make,model,registration_plate,odometer_km").eq("tenant_id", ctx.tenantId).neq("status", "SOLD").order("make")]);
  const vm = new Map((vehicles ?? []).map((v) => [v.id, v]));
  const edit = can(ctx, "maintenance.manage");
  return (
    <>
      <PageHeader title={t("admin.nav.maintenance")} subtitle={t("admin.maintenance.blocksHint")} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <form method="get" className="mb-4 flex gap-3"><select name="status" defaultValue={sp.status ?? ""} className="field py-2" aria-label={t("admin.common.status")}><option value="">{t("admin.common.all")}</option>{["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((s) => <option key={s} value={s}>{t(`admin.maintenance.statuses.${s}`)}</option>)}</select>{sp.vehicle ? <input type="hidden" name="vehicle" value={sp.vehicle} /> : null}<button className="btn-ghost px-4 py-2 text-sm">{t("admin.common.apply")}</button></form>
          {(rows ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
            <Table head={[t("admin.bookings.vehicle"), t("admin.common.type"), t("admin.common.from"), t("admin.common.status"), t("admin.common.amount"), ""]}>
              {(rows ?? []).map((m) => {
                const v = vm.get(m.vehicle_id);
                return (
                  <tr key={m.id}>
                    <td>{v ? <Link className="text-brand hover:underline" href={`/t/${ctx.slug}/fleet/${v.id}`}>{v.make} {v.model} · {v.registration_plate}</Link> : "—"}</td>
                    <td>{m.type === "CUSTOM" ? m.custom_type : t(`admin.maintenance.types.${m.type}`)}{m.provider ? <span className="block text-xs text-muted">{m.provider}</span> : null}</td>
                    <td className="whitespace-nowrap">{dt(m.scheduled_start, ctx.timezone, lang)}<span className="block text-xs text-muted">→ {dt(m.scheduled_end, ctx.timezone, lang)}</span></td>
                    <td><Badge status={m.status === "COMPLETED" ? "COMPLETED" : m.status === "CANCELLED" ? "CANCELLED" : "PENDING_APPROVAL"}>{t(`admin.maintenance.statuses.${m.status}`)}</Badge></td>
                    <td className="tabular-nums">{money(m.cost_minor, ctx.currency, lang)}</td>
                    <td>{edit && (m.status === "SCHEDULED" || m.status === "IN_PROGRESS") ? (
                      <div className="flex flex-wrap gap-1">
                        {m.status === "SCHEDULED" ? <ActionForm action={updateMaintenanceAction} lang={lang} submitLabel={t("admin.maintenance.start")} variant="ghost" className="inline-flex"><TenantFields slug={ctx.slug} /><Hidden name="id" value={m.id} /><Hidden name="status" value="IN_PROGRESS" /></ActionForm> : null}
                        <details><summary className="btn-ghost cursor-pointer px-3 py-2 text-sm">{t("admin.maintenance.complete")}</summary>
                          <ActionForm action={updateMaintenanceAction} lang={lang} submitLabel={t("admin.maintenance.complete")} className="mt-2 space-y-2"><TenantFields slug={ctx.slug} /><Hidden name="id" value={m.id} /><Hidden name="status" value="COMPLETED" />
                            <Field label={t("admin.common.amount")} name="cost" /><Field label={t("admin.inspections.odometer")} name="odometer" type="number" /></ActionForm></details>
                        <ActionForm action={updateMaintenanceAction} lang={lang} submitLabel={t("admin.common.cancel")} variant="danger" className="inline-flex" confirm={t("admin.common.confirm")}><TenantFields slug={ctx.slug} /><Hidden name="id" value={m.id} /><Hidden name="status" value="CANCELLED" /></ActionForm>
                      </div>) : null}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
        {edit ? (
          <Card title={t("admin.maintenance.schedule")}>
            <ActionForm action={scheduleMaintenanceAction} lang={lang} submitLabel={t("admin.maintenance.schedule")} resetOnSuccess>
              <TenantFields slug={ctx.slug} />
              <Select label={t("admin.bookings.vehicle")} name="vehicleId" required defaultValue={sp.vehicle ?? null} options={(vehicles ?? []).map((v) => ({ value: v.id, label: `${v.make} ${v.model} · ${v.registration_plate}` }))} />
              <Select label={t("admin.common.type")} name="type" required options={TYPES.map((x) => ({ value: x, label: t(`admin.maintenance.types.${x}`) }))} />
              <Field label={t("admin.maintenance.customType")} name="custom_type" />
              <Field label={t("admin.maintenance.provider")} name="provider" />
              <Field label={t("admin.common.from")} name="start" type="datetime-local" required />
              <Field label={t("admin.common.to")} name="end" type="datetime-local" required />
              <Field label={t("admin.maintenance.estimatedCost")} name="cost" />
              <Field label={t("admin.inspections.odometer")} name="odometer" type="number" />
              <TextArea label={t("admin.inspections.notes")} name="notes" rows={2} />
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
