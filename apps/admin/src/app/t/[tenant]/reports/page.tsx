import { BarList, ColumnChart } from "@/components/charts";
import { PeriodFilter } from "@/components/period-filter";
import { Card, Empty, LinkButton, PageHeader, Table } from "@/components/ui";
import { loadDashboard, periodFromSearch } from "@/lib/dashboard";
import { money, pct } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "reports.read");
  const { t, lang } = await getT();
  const period = periodFromSearch(await searchParams, ctx.timezone);
  const d = await loadDashboard(await userClient(), ctx.tenantId, period.from, period.to);
  const fm = (v: number) => money(v, ctx.currency, lang);
  const qs = (kind: string) => `/t/${ctx.slug}/reports/export?${new URLSearchParams({ kind, from: period.from, to: period.to })}`;
  return (
    <>
      <PageHeader title={t("admin.nav.reports")} actions={<>
        <PeriodFilter from={period.from} to={period.to} labels={{ from: t("admin.common.from"), to: t("admin.common.to"), apply: t("admin.common.apply") }} />
        <LinkButton variant="ghost" href={qs("bookings")}>{t("admin.reports.exportBookings")}</LinkButton>
        <LinkButton variant="ghost" href={qs("vehicles")}>{t("admin.reports.exportVehicles")}</LinkButton>
        <LinkButton variant="ghost" href={qs("payments")}>{t("admin.reports.exportPayments")}</LinkButton>
      </>} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={t("admin.overview.revenueOverTime")}><ColumnChart label={t("admin.overview.revenueOverTime")} format={{ kind: "money", currency: ctx.currency, lang }} data={d.series.map((s) => ({ x: s.day, y: s.revenueMinor, xLabel: s.day.slice(5) }))} /></Card>
        <Card title={t("admin.overview.bookingsOverTime")}><ColumnChart label={t("admin.overview.bookingsOverTime")} format={{ kind: "count" }} data={d.series.map((s) => ({ x: s.day, y: s.bookings, xLabel: s.day.slice(5) }))} /></Card>
        <Card title={t("admin.reports.byBranch")}>{d.byBranch.length ? <BarList label={t("admin.reports.byBranch")} format={{ kind: "money", currency: ctx.currency, lang }} rows={d.byBranch.map((b) => ({ key: b.branchId, label: b.name, sub: `${b.bookings}`, value: b.revenueMinor }))} /> : <Empty>{t("common.empty")}</Empty>}</Card>
        <Card title={t("admin.overview.revenueByCategory")}>{d.byCategory.length ? <BarList label={t("admin.overview.revenueByCategory")} format={{ kind: "money", currency: ctx.currency, lang }} rows={d.byCategory.map((c) => ({ key: c.category, label: t(`category.${c.category}`), sub: `${c.bookings}`, value: c.revenueMinor }))} /> : <Empty>{t("common.empty")}</Empty>}</Card>
      </div>
      <Card title={t("admin.reports.vehiclePerformance")} className="mt-6">
        <Table head={[t("admin.bookings.vehicle"), t("admin.nav.bookings"), t("admin.overview.revenue"), t("admin.overview.utilization")]}>
          {[...d.byVehicle].sort((a, b) => b.revenueMinor - a.revenueMinor).map((v) => <tr key={v.vehicleId}><td>{v.name} <span className="text-xs text-muted">{v.plate}</span></td><td className="tabular-nums">{v.bookings}</td><td className="tabular-nums">{fm(v.revenueMinor)}</td><td className="tabular-nums">{pct(v.utilization)}</td></tr>)}
        </Table>
      </Card>
    </>
  );
}
