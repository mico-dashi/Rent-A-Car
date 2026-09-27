import Link from "next/link";
import { BarList, ColumnChart } from "@/components/charts";
import { PeriodFilter } from "@/components/period-filter";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { loadDashboard, periodFromSearch } from "@/lib/dashboard";
import { money, pct } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import type { CurrencyCode } from "@rental/types";

export default async function Overview({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  const { t, lang } = await getT();
  if (!can(ctx, "reports.read")) {
    return (
      <>
        <PageHeader title={t("admin.nav.overview")} subtitle={ctx.name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href={`/t/${ctx.slug}/today`} className="card p-6 hover:border-brand"><p className="font-display text-lg font-bold">{t("admin.nav.today")}</p><p className="text-sm text-muted">{t("admin.today.subtitle")}</p></Link>
          <Link href={`/t/${ctx.slug}/bookings`} className="card p-6 hover:border-brand"><p className="font-display text-lg font-bold">{t("admin.nav.bookings")}</p></Link>
        </div>
      </>
    );
  }
  const period = periodFromSearch(await searchParams, ctx.timezone);
  const d = await loadDashboard(await userClient(), ctx.tenantId, period.from, period.to);
  const cur = d.currency as CurrencyCode;
  const fm = (v: number) => money(v, cur, lang);
  const short = (v: number) => new Intl.NumberFormat(lang, { notation: "compact", style: "currency", currency: cur }).format(v / 100);

  return (
    <>
      <PageHeader title={t("admin.nav.overview")} subtitle={ctx.name}
        actions={<PeriodFilter from={period.from} to={period.to} labels={{ from: t("admin.common.from"), to: t("admin.common.to"), apply: t("admin.common.apply") }} />} />
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{t("admin.overview.today")}</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={t("admin.overview.bookingsToday")} value={d.today.bookingsCreated} />
        <Stat label={t("admin.overview.pickups")} value={d.today.pickups} />
        <Stat label={t("admin.overview.returns")} value={d.today.returns} />
        <Stat label={t("admin.overview.activeRentals")} value={d.today.activeRentals} />
        <Stat label={t("admin.overview.overdue")} value={d.today.overdue} tone={d.today.overdue > 0 ? "bad" : undefined} />
        <Stat label={t("admin.overview.availableFleet")} value={`${d.today.availableFleet} / ${d.today.fleetSize}`} />
      </div>
      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-muted">{t("admin.overview.period")}</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t("admin.overview.revenue")} value={fm(d.period.revenueMinor)} hint={`${t("admin.overview.ytd")}: ${fm(d.yearToDateRevenueMinor)}`} />
        <Stat label={t("admin.overview.utilization")} value={pct(d.period.utilization)} />
        <Stat label={t("admin.overview.avgBooking")} value={fm(d.period.averageBookingValueMinor)} hint={`${d.period.bookings} ${t("admin.nav.bookings").toLowerCase()}`} />
        <Stat label={t("admin.overview.avgDuration")} value={`${d.period.averageRentalDays}`} hint={t("admin.overview.days")} />
        <Stat label={t("admin.overview.cancellationRate")} value={pct(d.period.cancellationRate)} />
        <Stat label={t("admin.overview.noShowRate")} value={pct(d.period.noShowRate)} />
        <Stat label={t("admin.overview.maintenanceCost")} value={fm(d.period.maintenanceCostMinor)} />
        <Stat label={t("admin.overview.returnRate")} value={pct(d.period.customerReturnRate)} />
      </div>
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Card title={t("admin.overview.revenueOverTime")}>
          <ColumnChart label={t("admin.overview.revenueOverTime")} format={short}
            data={d.series.map((s) => ({ x: s.day, y: s.revenueMinor, xLabel: s.day.slice(5) }))} />
        </Card>
        <Card title={t("admin.overview.bookingsOverTime")}>
          <ColumnChart label={t("admin.overview.bookingsOverTime")} format={(v) => String(Math.round(v))}
            data={d.series.map((s) => ({ x: s.day, y: s.bookings, xLabel: s.day.slice(5) }))} />
        </Card>
        <Card title={t("admin.overview.utilizationByVehicle")}>
          {d.byVehicle.length ? <BarList label={t("admin.overview.utilizationByVehicle")} format={pct}
            rows={[...d.byVehicle].sort((a, b) => b.utilization - a.utilization).slice(0, 10).map((v) => ({ key: v.vehicleId, label: v.name, sub: v.plate, value: v.utilization }))} /> : <Empty>{t("common.empty")}</Empty>}
        </Card>
        <Card title={t("admin.overview.revenueByCategory")}>
          {d.byCategory.length ? <BarList label={t("admin.overview.revenueByCategory")} format={fm}
            rows={d.byCategory.map((c) => ({ key: c.category, label: t(`category.${c.category}`), sub: `${c.bookings}`, value: c.revenueMinor }))} /> : <Empty>{t("common.empty")}</Empty>}
        </Card>
      </div>
    </>
  );
}
