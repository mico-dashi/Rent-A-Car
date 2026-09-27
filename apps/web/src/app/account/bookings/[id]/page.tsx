import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CUSTOMER_CANCELLABLE, quoteCancellation } from "@rental/domain";
import { formatDateTime, formatMoney } from "@rental/localization";
import type { PriceLine } from "@rental/types";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";
import { myBooking } from "@/lib/bookings";
import { userClient } from "@/lib/supabase/server";
import { PriceBreakdown } from "@/components/price-breakdown";
import { CancelBookingButton } from "./cancel-button";

export const metadata: Metadata = { title: "Booking", robots: { index: false } };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string }> }) {
  const tenant = await getTenant();
  const { lang, t } = await getT(tenant.language);
  const { id } = await params;
  const { paid } = await searchParams;
  const db = await userClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect(`/sign-in?next=/account/bookings/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = await myBooking(db, tenant.id, id);
  if (!b) notFound();

  const tz = b.pickup?.timezone ?? "UTC";
  const cancellation = quoteCancellation(
    { status: b.status, startsAt: new Date(b.starts_at), totalMinor: b.total_minor, amountPaidMinor: b.amount_paid_minor, amountRefundedMinor: b.amount_refunded_minor },
    { freeCancellationHours: tenant.freeCancellationHours, lateCancellationFeeBps: tenant.lateCancellationFeeBps },
    new Date(),
  );
  const lines: PriceLine[] = b.lines.map((l) => ({
    kind: l.kind as PriceLine["kind"], label: String(l.label), quantity: Number(l.quantity), unitAmountMinor: Number(l.unit_amount_minor),
    amountMinor: Number(l.amount_minor), isTaxable: Boolean(l.is_taxable),
  }));

  return (
    <div className="container-page grid gap-10 pt-12 lg:grid-cols-[1fr_380px]">
      <div>
        <p className="text-xs text-muted">{t("account.reference")} {b.reference}</p>
        <h1 className="font-display text-3xl font-black">{b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}` : "—"}</h1>
        <p className="mt-2 inline-block rounded-full border border-line px-3 py-1 text-sm font-semibold">{t(`booking.status.${b.status}`)}</p>
        {paid === "1" && b.status === "PENDING_PAYMENT" ? <p role="status" className="mt-4 text-sm text-ok">{t("checkout.success")}</p> : null}
        <dl className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="card p-5"><dt className="label">{t("search.pickupDate")}</dt><dd>{b.pickup?.name}<br />{formatDateTime(b.starts_at, tz, lang)}</dd></div>
          <div className="card p-5"><dt className="label">{t("search.returnDate")}</dt><dd>{b.ret?.name}<br />{formatDateTime(b.ends_at, tz, lang)}</dd></div>
        </dl>
        {CUSTOMER_CANCELLABLE.includes(b.status) && cancellation.allowed ? (
          <div className="mt-8">
            {cancellation.feeMinor === 0
              ? <p className="text-sm text-muted">{t("booking.freeCancellationUntil", { date: formatDateTime(cancellation.freeUntil, tz, lang) })}</p>
              : <p className="text-sm text-warn">{t("account.cancelFee", { amount: formatMoney(cancellation.feeMinor, b.currency, lang) })}</p>}
            <CancelBookingButton bookingId={b.id} version={b.version} lang={lang} />
          </div>
        ) : null}
      </div>
      <aside className="card h-fit p-6">
        <PriceBreakdown lang={lang} data={{ currency: b.currency, lines, totalMinor: b.total_minor, depositMinor: b.deposit_minor, dueNowMinor: b.due_now_minor, dueLaterMinor: b.total_minor - b.due_now_minor }} />
      </aside>
    </div>
  );
}
