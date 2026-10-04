import Link from "next/link";
import { ActionForm, Field, Hidden, Select } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { addBlockAction, releaseBlockAction } from "./actions";
import { Timeline, type TLBlock } from "./timeline";

const VIEWS = { day: 1, week: 7, month: 30, timeline: 14 } as const;

function parseRange(p: string): [number, number] {
  const m = /^[[(]"?([^",]+)"?,"?([^")]+)"?[\])]$/.exec(p);
  return [Date.parse(m?.[1] ?? ""), Date.parse(m?.[2] ?? "")];
}

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ view?: string; from?: string; branch?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "bookings.read");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const view = (sp.view && sp.view in VIEWS ? sp.view : "timeline") as keyof typeof VIEWS;
  const days = VIEWS[view];
  const fromDate = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : new Date().toISOString().slice(0, 10);
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = from + days * 86_400_000;
  const db = await userClient();
  let vq = db.from("vehicles").select("id,make,model,registration_plate,branch_id").eq("tenant_id", ctx.tenantId).neq("status", "SOLD").order("make");
  if (sp.branch) vq = vq.eq("branch_id", sp.branch);
  const [{ data: vehicles }, { data: blocks }, { data: branches }] = await Promise.all([
    vq,
    db.from("vehicle_availability_blocks").select("id,vehicle_id,kind,period,booking_id,hold_expires_at,reason").eq("tenant_id", ctx.tenantId).is("released_at", null)
      .overlaps("period" as never, `[${new Date(from).toISOString()},${new Date(to).toISOString()})` as never),
    db.from("branches").select("id,name").eq("tenant_id", ctx.tenantId),
  ]);
  const bookingIds = [...new Set((blocks ?? []).map((b) => b.booking_id).filter(Boolean))] as string[];
  const { data: bks } = bookingIds.length ? await db.from("bookings").select("id,reference,customer_id").in("id", bookingIds) : { data: [] };
  const bmap = new Map((bks ?? []).map((b) => [b.id, b]));
  const tl: TLBlock[] = (blocks ?? []).map((b) => {
    const [s, e] = parseRange(String(b.period));
    const bk = b.booking_id ? bmap.get(b.booking_id) : null;
    return {
      id: b.id, vehicleId: b.vehicle_id, kind: b.kind, start: s, end: e, bookingId: b.booking_id, hold: Boolean(b.hold_expires_at),
      label: bk ? bk.reference : t(`admin.calendar.kinds.${b.kind}`) + (b.reason ? ` · ${b.reason}` : ""),
      href: bk ? `/t/${ctx.slug}/bookings/${bk.id}` : null,
    };
  });
  const shift = (n: number) => `?${new URLSearchParams({ view, from: new Date(from + n * days * 86_400_000).toISOString().slice(0, 10), ...(sp.branch ? { branch: sp.branch } : {}) })}`;

  return (
    <>
      <PageHeader title={t("admin.nav.calendar")} actions={
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((v) => <Link key={v} href={`?view=${v}&from=${fromDate}${sp.branch ? `&branch=${sp.branch}` : ""}`} aria-current={v === view ? "page" : undefined} className={`btn-ghost px-3 py-1.5 text-xs ${v === view ? "border-brand" : ""}`}>{t(`admin.calendar.views.${v}`)}</Link>)}
          <Link href={shift(-1)} className="btn-ghost px-3 py-1.5 text-xs" aria-label={t("admin.common.previous")}>←</Link>
          <Link href={shift(1)} className="btn-ghost px-3 py-1.5 text-xs" aria-label={t("admin.common.next")}>→</Link>
          <form method="get" className="flex gap-2"><input type="hidden" name="view" value={view} /><input type="hidden" name="from" value={fromDate} />
            <select name="branch" defaultValue={sp.branch ?? ""} className="field py-1.5 text-xs" aria-label={t("admin.nav.branches")}><option value="">{t("admin.common.allBranches")}</option>{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <button className="btn-ghost px-3 py-1.5 text-xs">{t("admin.common.apply")}</button></form>
        </div>} />
      <Card>
        <Timeline vehicles={(vehicles ?? []).map((v) => ({ id: v.id, label: `${v.make} ${v.model} · ${v.registration_plate}` }))} blocks={tl} from={from} days={days}
          canMove={can(ctx, "bookings.write")} lang={lang} slug={ctx.slug} />
      </Card>
      {can(ctx, "vehicles.status") ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title={t("admin.calendar.addBlock")}>
            <ActionForm action={addBlockAction} lang={lang} submitLabel={t("admin.common.add")}>
              <TenantFields slug={ctx.slug} />
              <Select label={t("admin.bookings.vehicle")} name="vehicleId" required options={(vehicles ?? []).map((v) => ({ value: v.id, label: `${v.make} ${v.model} · ${v.registration_plate}` }))} />
              <Select label={t("admin.common.type")} name="kind" required options={[{ value: "MANUAL", label: t("admin.calendar.kinds.MANUAL") }, { value: "CLEANING", label: t("admin.calendar.kinds.CLEANING") }]} />
              <div className="grid gap-4 md:grid-cols-2"><Field label={t("admin.common.from")} name="start" type="datetime-local" required /><Field label={t("admin.common.to")} name="end" type="datetime-local" required /></div>
              <Field label={t("admin.common.reason")} name="reason" />
            </ActionForm>
          </Card>
          <Card title={t("admin.calendar.manualBlocks")}>
            <ul className="space-y-2">{(blocks ?? []).filter((b) => b.kind === "MANUAL" || b.kind === "CLEANING").map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 text-sm"><span>{(vehicles ?? []).find((v) => v.id === b.vehicle_id)?.registration_plate} · {t(`admin.calendar.kinds.${b.kind}`)} {b.reason ?? ""}</span>
                <ActionForm action={releaseBlockAction} lang={lang} submitLabel={t("admin.calendar.release")} variant="ghost" className="flex"><TenantFields slug={ctx.slug} /><Hidden name="blockId" value={b.id} /></ActionForm></li>
            ))}</ul>
          </Card>
        </div>
      ) : null}
    </>
  );
}
