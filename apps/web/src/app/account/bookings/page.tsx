import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { customerTab, type CustomerBookingTab } from "@rental/domain";
import { formatDateTime, formatMoney } from "@rental/localization";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";
import { myBookings } from "@/lib/bookings";
import { userClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My bookings", robots: { index: false } };
const TABS: CustomerBookingTab[] = ["UPCOMING", "ACTIVE", "PAST", "CANCELLED"];

export default async function MyBookingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tenant = await getTenant();
  const { lang, t } = await getT(tenant.language);
  const db = await userClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect("/sign-in?next=/account/bookings");
  const { tab } = await searchParams;
  const active: CustomerBookingTab = TABS.includes(tab as CustomerBookingTab) ? (tab as CustomerBookingTab) : "UPCOMING";
  const bookings = (await myBookings(db, tenant.id)).filter((b) => customerTab(b.status) === active);

  return (
    <div className="container-page pt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-black">{t("account.bookings")}</h1>
        <Link href="/account/privacy" className="text-sm text-muted underline">{t("account.privacyTitle")}</Link>
      </div>
      <nav aria-label="Booking tabs" className="mt-6 flex gap-2 overflow-x-auto">
        {TABS.map((k) => (
          <Link key={k} href={`/account/bookings?tab=${k}`} aria-current={k === active ? "page" : undefined}
            className={`btn-ghost whitespace-nowrap px-4 py-2 text-sm ${k === active ? "border-brand text-fg" : "text-muted"}`}>{t(`booking.tabs.${k}`)}</Link>
        ))}
      </nav>
      {bookings.length === 0 ? <div className="card mt-8 p-10 text-center text-muted">{t("common.empty")}</div> : (
        <ul className="mt-8 grid gap-4">
          {bookings.map((b) => (
            <li key={b.id}>
              <Link href={`/account/bookings/${b.id}`} className="card flex flex-wrap items-center justify-between gap-4 p-5 hover:border-brand">
                <div>
                  <p className="text-xs text-muted">{t("account.reference")} {b.reference}</p>
                  <p className="font-display text-lg font-bold">{b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}` : "—"}</p>
                  <p className="text-sm text-muted">{b.pickup?.name} · {formatDateTime(b.starts_at, b.pickup?.timezone ?? "UTC", lang, "short")} → {formatDateTime(b.ends_at, b.pickup?.timezone ?? "UTC", lang, "short")}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{t(`booking.status.${b.status}`)}</p>
                  <p className="font-display text-lg">{formatMoney(b.total_minor, b.currency, lang)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
