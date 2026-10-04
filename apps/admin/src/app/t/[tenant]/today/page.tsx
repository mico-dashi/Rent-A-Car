import Link from "next/link";
import { zonedLocalToUtc } from "@rental/domain";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { dt } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

/** Today's local-day window in the tenant timezone (DST-safe). */
function dayBounds(tz: string) {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const next = new Date(Date.parse(`${local}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: zonedLocalToUtc(`${local}T00:00`, tz).toISOString(), end: zonedLocalToUtc(`${next}T00:00`, tz).toISOString() };
}

export default async function TodayPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "bookings.read");
  const { t, lang } = await getT();
  const db = await userClient();
  const { start, end } = dayBounds(ctx.timezone);
  const sel = "id,reference,status,starts_at,ends_at,pickup_type,delivery_address,customer_id,vehicle_id,vehicle_class_id";
  const [pickups, returns, overdue, approvals, unassigned] = await Promise.all([
    db.from("bookings").select(sel).eq("tenant_id", ctx.tenantId).gte("starts_at", start).lt("starts_at", end).in("status", ["CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP", "ACTIVE"]).order("starts_at"),
    db.from("bookings").select(sel).eq("tenant_id", ctx.tenantId).gte("ends_at", start).lt("ends_at", end).in("status", ["ACTIVE", "RETURN_DUE", "RETURNED"]).order("ends_at"),
    db.from("bookings").select(sel).eq("tenant_id", ctx.tenantId).eq("status", "RETURN_DUE").order("ends_at"),
    db.from("bookings").select(sel).eq("tenant_id", ctx.tenantId).eq("status", "PENDING_APPROVAL").order("starts_at"),
    db.from("bookings").select(sel).eq("tenant_id", ctx.tenantId).is("vehicle_id", null).in("status", ["CONFIRMED", "PENDING_APPROVAL", "CHECK_IN_PENDING"]).lt("starts_at", new Date(Date.now() + 7 * 86_400_000).toISOString()).order("starts_at"),
  ]);
  const all = [pickups, returns, overdue, approvals, unassigned].flatMap((r) => r.data ?? []);
  const cIds = [...new Set(all.map((b) => b.customer_id))];
  const vIds = [...new Set(all.map((b) => b.vehicle_id).filter(Boolean))] as string[];
  const [{ data: cs }, { data: vs }] = await Promise.all([
    cIds.length ? db.from("customers").select("id,first_name,last_name,phone").in("id", cIds) : Promise.resolve({ data: [] }),
    vIds.length ? db.from("vehicles").select("id,make,model,registration_plate").in("id", vIds) : Promise.resolve({ data: [] }),
  ]);
  const cm = new Map((cs ?? []).map((c) => [c.id, c]));
  const vm = new Map((vs ?? []).map((v) => [v.id, v]));

  const List = ({ title, rows, time, action }: { title: string; rows: typeof all; time: "starts_at" | "ends_at"; action?: "pickup" | "return" }) => (
    <Card title={`${title} (${rows.length})`}>
      {rows.length === 0 ? <Empty>{t("common.empty")}</Empty> : (
        <ul className="divide-y divide-line">
          {rows.map((b) => {
            const c = cm.get(b.customer_id);
            const v = b.vehicle_id ? vm.get(b.vehicle_id) : null;
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="text-sm">
                  <Link href={`/t/${ctx.slug}/bookings/${b.id}`} className="font-semibold text-brand hover:underline">{b.reference}</Link>
                  <span className="ml-2">{c ? `${c.first_name} ${c.last_name}` : ""}</span>
                  {c?.phone ? <a className="ml-2 text-muted" href={`tel:${c.phone.replace(/\s/g, "")}`}>{c.phone}</a> : null}
                  <p className="text-muted">{v ? `${v.make} ${v.model} · ${v.registration_plate}` : t("admin.bookings.unassigned")} · {dt(b[time], ctx.timezone, lang)}
                    {b.pickup_type !== "BRANCH" ? ` · ${t(`admin.pickupType.${b.pickup_type}`)}${b.delivery_address ? `: ${b.delivery_address}` : ""}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge status={b.status}>{t(`booking.status.${b.status}`)}</Badge>
                  {action ? <Link className="btn-ghost px-3 py-1.5 text-xs" href={`/t/${ctx.slug}/bookings/${b.id}/${action}`}>{t(action === "pickup" ? "admin.pickup.start" : "admin.return.start")}</Link> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader title={t("admin.nav.today")} subtitle={t("admin.today.subtitle")} />
      <div className="grid gap-6 xl:grid-cols-2">
        <List title={t("admin.overview.pickups")} rows={(pickups.data ?? []).filter((b) => b.status !== "ACTIVE")} time="starts_at" action="pickup" />
        <List title={t("admin.overview.returns")} rows={(returns.data ?? []).filter((b) => b.status !== "RETURNED")} time="ends_at" action="return" />
        <List title={t("admin.overview.overdue")} rows={overdue.data ?? []} time="ends_at" action="return" />
        <List title={t("admin.today.approvals")} rows={approvals.data ?? []} time="starts_at" />
        <List title={t("admin.today.unassigned")} rows={unassigned.data ?? []} time="starts_at" />
      </div>
    </>
  );
}
