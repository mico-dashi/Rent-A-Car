import type { Metadata } from "next";
import Link from "next/link";
import { listCatalog } from "@rental/api-client";
import { VEHICLE_CATEGORIES, type VehicleCategory } from "@rental/types";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";
import { publicClient } from "@/lib/supabase/server";
import { VehicleCard } from "@/components/vehicle-card";

export const metadata: Metadata = { title: "Fleet", alternates: { canonical: "/fleet" } };

export default async function FleetPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const tenant = await getTenant();
  const { lang, t } = await getT(tenant.language);
  const { category } = await searchParams;
  const selected = VEHICLE_CATEGORIES.includes(category as VehicleCategory) ? (category as VehicleCategory) : undefined;
  const fleet = await listCatalog(publicClient(), tenant.id, { ...(selected ? { category: selected } : {}), limit: 96 });
  return (
    <div className="container-page pt-12">
      <h1 className="font-display text-3xl font-black md:text-4xl">{t("nav.fleet")}</h1>
      <nav aria-label="Categories" className="mt-6 flex gap-2 overflow-x-auto pb-2">
        <Link href="/fleet" aria-current={!selected ? "page" : undefined} className={`btn-ghost px-4 py-2 text-sm ${!selected ? "border-brand" : ""}`}>{t("common.total")}</Link>
        {VEHICLE_CATEGORIES.map((c) => (
          <Link key={c} href={`/fleet?category=${c}`} aria-current={selected === c ? "page" : undefined} className={`btn-ghost whitespace-nowrap px-4 py-2 text-sm ${selected === c ? "border-brand" : ""}`}>{t(`category.${c}`)}</Link>
        ))}
      </nav>
      {fleet.length === 0 ? <p className="mt-10 text-muted">{t("common.empty")}</p> : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {fleet.map((v, i) => <VehicleCard key={v.id} v={v} lang={lang} href={`/vehicles/${v.id}`} priority={i < 3} />)}
        </div>
      )}
    </div>
  );
}
