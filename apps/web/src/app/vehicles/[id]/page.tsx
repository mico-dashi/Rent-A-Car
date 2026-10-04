import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCatalogVehicle, listBranches, listVehicleImages } from "@rental/api-client";
import { formatMoney } from "@rental/localization";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { publicClient } from "@/lib/supabase/server";
import { QuoteWidget } from "@/components/quote-widget";

type Params = { id: string };
type SP = { pickup?: string; return?: string; start?: string; end?: string };
const UUID = /^[0-9a-f-]{36}$/i;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return {};
  const tenant = await getTenant();
  const v = await getCatalogVehicle(publicClient(), tenant.id, id);
  if (!v) return {};
  const img = mediaUrl(v.thumbnail_path);
  return {
    title: `${v.make} ${v.model}`,
    description: v.description ?? undefined,
    alternates: { canonical: `/vehicles/${v.id}` },
    openGraph: { title: `${v.make} ${v.model}`, ...(img && !img.endsWith(".svg") ? { images: [img] } : {}) },
  };
}

export default async function VehiclePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<SP> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const tenant = await getTenant();
  const { lang, t } = await getT(tenant.language);
  const db = publicClient();
  const [v, images, branches] = await Promise.all([getCatalogVehicle(db, tenant.id, id), listVehicleImages(db, id), listBranches(db, tenant.id)]);
  if (!v) notFound();
  const sp = await searchParams;
  const branch = branches.find((b) => b.id === v.branch_id);
  const cur = v.currency;

  const specs: [string, string | null][] = [
    [t("vehicle.specs"), `${v.year}${v.trim ? ` · ${v.trim}` : ""}`],
    [t(`vehicle.transmission.${v.transmission}`), t("vehicle.seats", { count: v.seats })],
    [t(`vehicle.fuel.${v.fuel_type}`), v.electric_range_km ? t("vehicle.range", { count: v.electric_range_km }) : v.engine],
    [v.horsepower ? t("vehicle.horsepower", { count: v.horsepower }) : null, v.drivetrain] as [string, string | null],
    [t("vehicle.doors", { count: v.doors }), v.luggage !== null ? t("vehicle.luggage", { count: v.luggage }) : null],
  ].filter(([a]) => a) as [string, string | null][];

  const productLd = {
    "@context": "https://schema.org", "@type": "Product", name: `${v.make} ${v.model}`, brand: v.make,
    offers: { "@type": "Offer", priceCurrency: cur, price: (v.daily_rate_minor / 100).toFixed(2), availability: "https://schema.org/InStock" },
    ...(v.rating_count > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: v.rating_avg, reviewCount: v.rating_count } } : {}),
  };

  return (
    <div className="container-page pt-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd).replace(/</g, "\\u003c") }} />
      <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          <p className="eyebrow">{t(`category.${v.category}`)}</p>
          <h1 className="mt-2 font-display text-4xl font-black tracking-tight md:text-5xl">{v.make} {v.model}</h1>
          <div className="mt-6 grid gap-3">
            {images.length === 0 ? <div className="card aspect-[16/9]" /> : images.map((img, i) => {
              const src = mediaUrl(img.storage_path);
              return src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.id} src={src} alt={img.alt_text ?? `${v.make} ${v.model}`} width={img.width ?? undefined} height={img.height ?? undefined}
                  loading={i === 0 ? "eager" : "lazy"} className="card aspect-[16/9] w-full object-cover" />
              ) : null;
            })}
          </div>
          {v.description ? <p className="mt-8 max-w-2xl text-lg text-muted">{v.description}</p> : null}

          <section className="mt-10">
            <h2 className="font-display text-xl font-bold">{t("vehicle.specs")}</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {specs.map(([a, b], i) => <div key={i} className="card flex justify-between p-4 text-sm"><dt>{a}</dt><dd className="text-muted">{b}</dd></div>)}
            </dl>
            {v.features.length ? (
              <ul className="mt-4 flex flex-wrap gap-2">{v.features.map((f) => <li key={f} className="rounded-full border border-line px-3 py-1 text-xs">{t(`vehicle.features.${f}`)}</li>)}</ul>
            ) : null}
          </section>

          <section className="mt-10">
            <h2 className="font-display text-xl font-bold">{t("vehicle.conditions")}</h2>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li>{t("vehicle.deposit")}: <span className="text-fg">{formatMoney(v.deposit_minor, cur, lang)}</span></li>
              <li>{t("vehicle.minAge", { age: v.minimum_driver_age })}</li>
              <li>{v.included_km_per_day === null ? t("vehicle.unlimitedMileage") : t("vehicle.mileage", { km: v.included_km_per_day })}</li>
              {v.included_km_per_day !== null ? <li>{t("vehicle.extraKm", { price: formatMoney(v.extra_km_rate_minor, cur, lang) })}</li> : null}
              <li>{t("vehicle.freeCancellationHours", { hours: tenant.freeCancellationHours })}</li>
              {branch ? <li>{t("search.pickupLocation")}: <span className="text-fg">{branch.name}</span> — {branch.address_line1}, {branch.city}</li> : null}
            </ul>
          </section>
        </div>
        <aside>
          <QuoteWidget tenantId={tenant.id} vehicleId={v.id} vehicleBranchId={v.branch_id} lang={lang}
            branches={branches.map((b) => ({ id: b.id, name: b.name, timezone: b.timezone }))}
            initial={{ ...(sp.pickup ? { pickup: sp.pickup } : {}), ...(sp.return ? { ret: sp.return } : {}), ...(sp.start ? { start: sp.start } : {}), ...(sp.end ? { end: sp.end } : {}) }} />
        </aside>
      </div>
    </div>
  );
}
