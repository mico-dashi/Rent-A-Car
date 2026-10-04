import Link from "next/link";
import { VEHICLE_STATUSES } from "@rental/types";
import { Badge, Card, Empty, LinkButton, PageHeader, Table } from "@/components/ui";
import { money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

export default async function FleetPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ status?: string; branch?: string; q?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "vehicles.read");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const db = await userClient();
  let q = db.from("vehicles").select("id,fleet_number,registration_plate,make,model,year,category,status,daily_rate_minor,is_published,odometer_km,branch_id").eq("tenant_id", ctx.tenantId).order("fleet_number");
  if (sp.status && (VEHICLE_STATUSES as readonly string[]).includes(sp.status)) q = q.eq("status", sp.status as never);
  if (sp.branch) q = q.eq("branch_id", sp.branch);
  if (sp.q) { const s = sp.q.replace(/[%,()]/g, ""); q = q.or(`make.ilike.%${s}%,model.ilike.%${s}%,registration_plate.ilike.%${s}%,fleet_number.ilike.%${s}%`); }
  const [{ data: vehicles }, { data: branches }, { data: docs }] = await Promise.all([
    q, db.from("branches").select("id,name").eq("tenant_id", ctx.tenantId),
    db.from("vehicle_documents").select("vehicle_id,kind,expires_on").eq("tenant_id", ctx.tenantId).lte("expires_on", new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)),
  ]);
  const bn = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const expiring = new Map<string, string[]>();
  for (const d of docs ?? []) expiring.set(d.vehicle_id, [...(expiring.get(d.vehicle_id) ?? []), t(`admin.fleet.docKinds.${d.kind}`)]);
  return (
    <>
      <PageHeader title={t("admin.nav.fleet")} subtitle={`${(vehicles ?? []).length}`} actions={<>
        <LinkButton variant="ghost" href={`/t/${ctx.slug}/fleet/classes`}>{t("admin.fleet.classes")}</LinkButton>
        {can(ctx, "vehicles.write") ? <LinkButton href={`/t/${ctx.slug}/fleet/new`}>{t("admin.fleet.add")}</LinkButton> : null}</>} />
      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="q">{t("admin.common.search")}</label><input id="q" name="q" defaultValue={sp.q ?? ""} className="field py-2" /></div>
          <div><label className="label" htmlFor="status">{t("admin.common.status")}</label><select id="status" name="status" defaultValue={sp.status ?? ""} className="field py-2"><option value="">—</option>{VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{t(`admin.vehicleStatus.${s}`)}</option>)}</select></div>
          <div><label className="label" htmlFor="branch">{t("admin.nav.branches")}</label><select id="branch" name="branch" defaultValue={sp.branch ?? ""} className="field py-2"><option value="">—</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <button className="btn-ghost px-4 py-2 text-sm">{t("admin.common.apply")}</button>
        </form>
        {(vehicles ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
          <Table head={["#", t("admin.bookings.vehicle"), t("admin.fleet.fields.plate"), t("admin.fleet.fields.branch"), t("admin.common.status"), t("admin.fleet.fields.dailyRate"), t("admin.fleet.fields.odometer"), ""]}>
            {(vehicles ?? []).map((v) => (
              <tr key={v.id}>
                <td className="text-muted">{v.fleet_number}</td>
                <td><Link className="font-semibold text-brand hover:underline" href={`/t/${ctx.slug}/fleet/${v.id}`}>{v.make} {v.model}</Link> <span className="text-xs text-muted">{v.year} · {t(`category.${v.category}`)}</span></td>
                <td>{v.registration_plate}</td>
                <td>{bn.get(v.branch_id) ?? "—"}</td>
                <td><Badge status={v.status === "AVAILABLE" ? "CONFIRMED" : v.status === "DAMAGED" ? "CANCELLED" : "PENDING_APPROVAL"}>{t(`admin.vehicleStatus.${v.status}`)}</Badge>{!v.is_published ? <span className="ml-1 text-xs text-muted">{t("admin.fleet.unpublished")}</span> : null}</td>
                <td className="tabular-nums">{money(v.daily_rate_minor, ctx.currency, lang)}</td>
                <td className="tabular-nums">{v.odometer_km.toLocaleString(lang)} km</td>
                <td>{expiring.get(v.id) ? <span className="text-xs text-warn" title={expiring.get(v.id)!.join(", ")}>⚠ {expiring.get(v.id)!.join(", ")}</span> : null}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
