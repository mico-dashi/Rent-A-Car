import Link from "next/link";
import { DAMAGE_STATUSES } from "@rental/types";
import { Badge, Card, Empty, PageHeader, Table } from "@/components/ui";
import { dt, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

export default async function DamagesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ status?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "damages.read");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const db = await userClient();
  let q = db.from("vehicle_damages").select("*").eq("tenant_id", ctx.tenantId).order("discovered_at", { ascending: false }).limit(200);
  if (sp.status && (DAMAGE_STATUSES as readonly string[]).includes(sp.status)) q = q.eq("status", sp.status as never);
  const [{ data: rows }, { data: vehicles }, { data: ai }] = await Promise.all([
    q, db.from("vehicles").select("id,make,model,registration_plate").eq("tenant_id", ctx.tenantId),
    db.from("damage_ai_assessments").select("id").eq("tenant_id", ctx.tenantId).eq("review_status", "PENDING_REVIEW"),
  ]);
  const vm = new Map((vehicles ?? []).map((v) => [v.id, `${v.make} ${v.model} · ${v.registration_plate}`]));
  return (
    <>
      <PageHeader title={t("admin.nav.damages")} subtitle={(ai ?? []).length ? t("admin.damages.aiPending", { count: (ai ?? []).length }) : undefined} />
      <Card>
        <form method="get" className="mb-4 flex gap-3"><select name="status" defaultValue={sp.status ?? ""} className="field py-2" aria-label={t("admin.common.status")}><option value="">{t("admin.common.all")}</option>{DAMAGE_STATUSES.map((s) => <option key={s} value={s}>{t(`admin.damages.statuses.${s}`)}</option>)}</select><button className="btn-ghost px-4 py-2 text-sm">{t("admin.common.apply")}</button></form>
        {(rows ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
          <Table head={[t("admin.common.type"), t("admin.bookings.vehicle"), t("admin.common.date"), t("admin.common.status"), t("admin.damages.estimated"), ""]}>
            {(rows ?? []).map((x) => (
              <tr key={x.id}>
                <td><Link className="text-brand hover:underline" href={`/t/${ctx.slug}/damages/${x.id}`}>{t(`admin.damages.types.${x.damage_type}`)}</Link>{x.location ? <span className="block text-xs text-muted">{x.location}</span> : null}</td>
                <td>{vm.get(x.vehicle_id) ?? "—"}</td><td>{dt(x.discovered_at, ctx.timezone, lang)}</td>
                <td><Badge status={x.status === "CLOSED" || x.status === "REPAIRED" ? "COMPLETED" : x.status === "CUSTOMER_RESPONSIBLE" ? "CANCELLED" : "PENDING_APPROVAL"}>{t(`admin.damages.statuses.${x.status}`)}</Badge>{x.is_pre_existing ? <span className="ml-1 text-xs text-muted">{t("admin.damages.preExisting")}</span> : null}</td>
                <td className="tabular-nums">{money(x.estimated_cost_minor, ctx.currency, lang)}</td><td />
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
