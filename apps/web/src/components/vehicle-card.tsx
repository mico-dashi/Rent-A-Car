import Link from "next/link";
import { createTranslator, formatMoney } from "@rental/localization";
import type { CatalogVehicle, LanguageCode } from "@rental/types";
import { thumbnailUrl } from "@/lib/media";

export function VehicleCard({ v, lang, href, priority = false }: { v: CatalogVehicle; lang: LanguageCode; href: string; priority?: boolean }) {
  const t = createTranslator(lang);
  const img = thumbnailUrl(v.thumbnail_path);
  return (
    <Link href={href} className="card group flex flex-col overflow-hidden transition-transform duration-300 hover:-translate-y-1 focus-visible:-translate-y-1">
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-raised to-bg">
        {img ? (
          // Thumbnails only (resized by storage); originals are never loaded in lists.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={`${v.make} ${v.model}`} loading={priority ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : null}
        <span className="absolute left-3 top-3 rounded-full bg-[color-mix(in_srgb,var(--color-background)_70%,transparent)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">
          {t(`category.${v.category}`)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="font-display text-lg font-bold leading-tight">{v.make} {v.model}</h3>
          <p className="text-sm text-muted">{[v.trim, v.year].filter(Boolean).join(" · ")}</p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <li>{t(`vehicle.transmission.${v.transmission}`)}</li>
          <li>{t("vehicle.seats", { count: v.seats })}</li>
          {v.horsepower ? <li>{t("vehicle.horsepower", { count: v.horsepower })}</li> : null}
          {v.electric_range_km ? <li>{t("vehicle.range", { count: v.electric_range_km })}</li> : <li>{t(`vehicle.fuel.${v.fuel_type}`)}</li>}
        </ul>
        <div className="mt-auto flex items-end justify-between border-t border-line pt-4">
          <p>
            <span className="text-xs text-muted">{t("common.from")} </span>
            <span className="font-display text-xl font-bold">{formatMoney(v.daily_rate_minor, v.currency, lang, { compact: true })}</span>
            <span className="text-xs text-muted"> / {t("common.perDay")}</span>
          </p>
          {v.rating_count > 0 ? <p className="text-xs text-muted">★ {Number(v.rating_avg).toFixed(1)}</p> : null}
        </div>
      </div>
    </Link>
  );
}

export function VehicleCardSkeleton() {
  return (
    <div className="card overflow-hidden" aria-hidden>
      <div className="skeleton aspect-[16/10] rounded-none" />
      <div className="space-y-3 p-5"><div className="skeleton h-5 w-2/3" /><div className="skeleton h-4 w-1/3" /><div className="skeleton h-8 w-1/2" /></div>
    </div>
  );
}
