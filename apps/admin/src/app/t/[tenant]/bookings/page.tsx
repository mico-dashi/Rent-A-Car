import Link from "next/link";
import { BOOKING_STATUSES } from "@rental/types";
import { Badge, Card, Empty, LinkButton, PageHeader, Pager, Table } from "@/components/ui";
import { dt, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

const PAGE = 25;
type SP = { status?: string; q?: string; from?: string; to?: string; page?: string };

export default async function BookingsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<SP> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "bookings.read");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const db = await userClient();

  let q = db.from("bookings").select("id,reference,status,starts_at,ends_at,total_minor,currency,payment_status,customer_id,vehicle_id,vehicle_class_id")
    .eq("tenant_id", ctx.tenantId).order("starts_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
  if (sp.status && (BOOKING_STATUSES as readonly string[]).includes(sp.status)) q = q.eq("status", sp.status as never);
  if (sp.from) q = q.gte("starts_at", sp.from);
  if (sp.to) q = q.lte("starts_at", `${sp.to}T23:59:59Z`);
  if (sp.q) {
    const term = sp.q.replace(/[%,()]/g, "").slice(0, 60);
    const { data: cust } = await db.from("customers").select("id").eq("tenant_id", ctx.tenantId)
      .or(`email.ilike.%${term}%,last_name.ilike.%${term}%,first_name.ilike.%${term}%`).limit(50);
    const ids = (cust ?? []).map((c) => c.id);
    q = ids.length ? q.or(`reference.ilike.%${term}%,customer_id.in.(${ids.join(",")})`) : q.ilike("reference", `%${term}%`);
  }
  const { data } = await q;
  const rows = (data ?? []).slice(0, PAGE);
  const custIds = [...new Set(rows.map((r) => r.customer_id))];
  const vehIds = [...new Set(rows.map((r) => r.vehicle_id).filter(Boolean))] as string[];
  const [{ data: customers }, { data: vehicles }] = await Promise.all([
    custIds.length ? db.from("customers").select("id,first_name,last_name").in("id", custIds) : Promise.resolve({ data: [] }),
    vehIds.length ? db.from("vehicles").select("id,make,model,registration_plate").in("id", vehIds) : Promise.resolve({ data: [] }),
  ]);
  const cm = new Map((customers ?? []).map((c) => [c.id, `${c.first_name} ${c.last_name}`]));
  const vm = new Map((vehicles ?? []).map((v) => [v.id, `${v.make} ${v.model} · ${v.registration_plate}`]));
  const href = (p: number) => `?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) })}`;

  return (
    <>
      <PageHeader title={t("admin.nav.bookings")} actions={can(ctx, "bookings.write") ? <LinkButton href={`/t/${ctx.slug}/bookings/new`}>{t("admin.bookings.new")}</LinkButton> : null} />
      <Card>
        <form method="get" className="mb-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-end">
          <div><label className="label" htmlFor="q">{t("admin.common.search")}</label><input id="q" name="q" defaultValue={sp.q ?? ""} className="field py-2" placeholder={t("admin.bookings.searchHint")} /></div>
          <div><label className="label" htmlFor="status">{t("admin.common.status")}</label>
            <select id="status" name="status" defaultValue={sp.status ?? ""} className="field py-2"><option value="">—</option>{BOOKING_STATUSES.map((s) => <option key={s} value={s}>{t(`booking.status.${s}`)}</option>)}</select></div>
          <div><label className="label" htmlFor="from">{t("admin.common.from")}</label><input id="from" name="from" type="date" defaultValue={sp.from ?? ""} className="field py-2" /></div>
          <div><label className="label" htmlFor="to">{t("admin.common.to")}</label><input id="to" name="to" type="date" defaultValue={sp.to ?? ""} className="field py-2" /></div>
          <button className="btn-ghost px-4 py-2 text-sm">{t("admin.common.apply")}</button>
        </form>
        {rows.length === 0 ? <Empty>{t("common.empty")}</Empty> : (
          <Table head={[t("admin.bookings.reference"), t("admin.bookings.customer"), t("admin.bookings.vehicle"), t("admin.bookings.pickup"), t("admin.bookings.return"), t("admin.common.status"), t("common.total")]}>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><Link className="font-semibold text-brand hover:underline" href={`/t/${ctx.slug}/bookings/${b.id}`}>{b.reference}</Link></td>
                <td>{cm.get(b.customer_id) ?? "—"}</td>
                <td>{b.vehicle_id ? vm.get(b.vehicle_id) : <span className="text-warn">{t("admin.bookings.unassigned")}</span>}</td>
                <td className="whitespace-nowrap">{dt(b.starts_at, ctx.timezone, lang)}</td>
                <td className="whitespace-nowrap">{dt(b.ends_at, ctx.timezone, lang)}</td>
                <td><Badge status={b.status}>{t(`booking.status.${b.status}`)}</Badge></td>
                <td className="whitespace-nowrap tabular-nums">{money(b.total_minor, ctx.currency, lang)}<br /><span className="text-xs text-muted">{t(`admin.paymentStatus.${b.payment_status}`)}</span></td>
              </tr>
            ))}
          </Table>
        )}
        <Pager page={page} hasMore={(data ?? []).length > PAGE} href={href} />
      </Card>
    </>
  );
}
