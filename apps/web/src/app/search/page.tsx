import type { Metadata } from "next";
import { listBranches, searchAvailable } from "@rental/api-client";
import { BusinessError, type CatalogVehicle } from "@rental/types";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";
import { publicClient } from "@/lib/supabase/server";
import { SearchForm } from "@/components/search-form";
import { VehicleCard } from "@/components/vehicle-card";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

type SP = { pickup?: string; return?: string; start?: string; end?: string; sort?: string; transmission?: string; seats?: string; ev?: string; max?: string };

const SORTS = ["recommended", "price_asc", "price_desc", "newest", "rating"] as const;

function applyFilters(list: CatalogVehicle[], sp: SP): CatalogVehicle[] {
  let out = list;
  if (sp.transmission === "AUTOMATIC" || sp.transmission === "MANUAL") out = out.filter((v) => v.transmission === sp.transmission);
  if (sp.seats) out = out.filter((v) => v.seats >= Number(sp.seats));
  if (sp.ev === "1") out = out.filter((v) => v.fuel_type === "ELECTRIC");
  if (sp.max) out = out.filter((v) => v.daily_rate_minor <= Number(sp.max) * 100);
  const sort = SORTS.includes(sp.sort as (typeof SORTS)[number]) ? sp.sort : "recommended";
  const sorted = [...out];
  if (sort === "price_asc") sorted.sort((a, b) => a.daily_rate_minor - b.daily_rate_minor);
  if (sort === "price_desc") sorted.sort((a, b) => b.daily_rate_minor - a.daily_rate_minor);
  if (sort === "newest") sorted.sort((a, b) => b.year - a.year);
  if (sort === "rating" || sort === "recommended") sorted.sort((a, b) => Number(b.rating_avg) - Number(a.rating_avg) || b.year - a.year);
  return sorted;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const tenant = await getTenant();
  const { lang, t } = await getT(tenant.language);
  const sp = await searchParams;
  const db = publicClient();
  const branches = await listBranches(db, tenant.id);
  const valid = sp.pickup && sp.start && sp.end && !Number.isNaN(Date.parse(sp.start)) && !Number.isNaN(Date.parse(sp.end));

  let results: CatalogVehicle[] = [];
  let errorCode: string | null = null;
  if (valid) {
    try {
      results = applyFilters(await searchAvailable(db, { tenantId: tenant.id, pickupBranchId: sp.pickup!, startsAt: sp.start!, endsAt: sp.end! }), sp);
    } catch (e) {
      errorCode = e instanceof BusinessError ? e.code : "INTERNAL_ERROR";
    }
  }
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(sp as Record<string, string>), ...extra }).toString();
  const vehicleHref = (id: string) => `/vehicles/${id}?${new URLSearchParams({ pickup: sp.pickup ?? "", return: sp.return ?? sp.pickup ?? "", start: sp.start ?? "", end: sp.end ?? "" })}`;

  return (
    <div className="container-page pt-10">
      <SearchForm branches={branches.map((b) => ({ id: b.id, name: b.name, timezone: b.timezone }))} lang={lang}
        initial={{ ...(sp.pickup ? { pickup: sp.pickup } : {}), ...(sp.return ? { ret: sp.return } : {}), ...(sp.start ? { start: sp.start } : {}), ...(sp.end ? { end: sp.end } : {}) }} />

      {valid ? (
        <div className="mt-10 grid gap-8 lg:grid-cols-[240px_1fr]">
          <aside aria-label="Filters" className="space-y-5 text-sm">
            <form method="get" className="space-y-5">
              {(["pickup", "return", "start", "end"] as const).map((k) => sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null)}
              <div><label className="label" htmlFor="sort">{t("search.filters.sort")}</label>
                <select id="sort" name="sort" defaultValue={sp.sort ?? "recommended"} className="field">
                  {SORTS.map((s) => <option key={s} value={s}>{t(`search.sort.${s}`)}</option>)}
                </select></div>
              <div><label className="label" htmlFor="transmission">{t("search.filters.transmission")}</label>
                <select id="transmission" name="transmission" defaultValue={sp.transmission ?? ""} className="field">
                  <option value="">—</option><option value="AUTOMATIC">{t("vehicle.transmission.AUTOMATIC")}</option><option value="MANUAL">{t("vehicle.transmission.MANUAL")}</option>
                </select></div>
              <div><label className="label" htmlFor="seats">{t("search.filters.seats")}</label>
                <select id="seats" name="seats" defaultValue={sp.seats ?? ""} className="field"><option value="">—</option>{[2, 4, 5, 7].map((n) => <option key={n} value={n}>{n}+</option>)}</select></div>
              <div><label className="label" htmlFor="max">{t("search.filters.maxPerDay")}</label><input id="max" name="max" type="number" min={0} inputMode="numeric" defaultValue={sp.max ?? ""} className="field" /></div>
              <label className="flex items-center gap-2"><input type="checkbox" name="ev" value="1" defaultChecked={sp.ev === "1"} className="accent-[var(--color-primary)]" /> {t("category.ELECTRIC")}</label>
              <button className="btn-ghost w-full" type="submit">{t("common.search")}</button>
              <a className="block text-center text-xs text-muted underline" href={`/search?${qs({ sort: "", transmission: "", seats: "", ev: "", max: "" })}`}>{t("search.filters.reset")}</a>
            </form>
          </aside>
          <section aria-live="polite">
            {errorCode ? (
              <div role="alert" className="card p-6"><p>{t(`errors.${errorCode}`)}</p></div>
            ) : (
              <>
                <p className="mb-5 text-sm text-muted">{t("search.results", { count: results.length })}</p>
                {results.length === 0 ? <div className="card p-10 text-center text-muted">{t("search.noResults")}</div> : (
                  <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                    {results.map((v, i) => <VehicleCard key={v.id} v={v} lang={lang} href={vehicleHref(v.id)} priority={i < 3} />)}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
