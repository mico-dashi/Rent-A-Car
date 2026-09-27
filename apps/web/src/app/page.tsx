import Link from "next/link";
import { listBranches, listCatalog } from "@rental/api-client";
import { VEHICLE_CATEGORIES } from "@rental/types";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { publicClient } from "@/lib/supabase/server";
import { SearchForm } from "@/components/search-form";
import { VehicleCard } from "@/components/vehicle-card";

export default async function HomePage() {
  const tenant = await getTenant();
  const { lang, t } = await getT(tenant.language);
  const db = publicClient();
  const [branches, fleet] = await Promise.all([listBranches(db, tenant.id), listCatalog(db, tenant.id, { limit: 12 })]);
  const hero = mediaUrl(tenant.branding.heroImagePath, "tenant-branding");
  const categories = VEHICLE_CATEGORIES.filter((c) => fleet.some((v) => v.category === c));

  const jsonLd = {
    "@context": "https://schema.org", "@type": "AutoRental", name: tenant.displayName,
    ...(tenant.branding.contactPhone ? { telephone: tenant.branding.contactPhone } : {}),
    ...(tenant.branding.contactEmail ? { email: tenant.branding.contactEmail } : {}),
    address: branches.map((b) => ({ "@type": "PostalAddress", streetAddress: b.address_line1, addressLocality: b.city, addressCountry: b.country_code })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <section className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_srgb,var(--color-primary)_22%,transparent),transparent_55%)]" />
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero} alt="" aria-hidden className="absolute inset-0 -z-20 h-full w-full object-cover opacity-30" />
        ) : null}
        <div className="container-page pb-16 pt-20 md:pb-24 md:pt-28">
          <p className="eyebrow">{tenant.displayName}</p>
          <h1 className="mt-4 max-w-3xl font-display text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
            {tenant.branding.headline ?? tenant.displayName}
          </h1>
          {tenant.branding.subheadline ? <p className="mt-5 max-w-2xl text-lg text-muted">{tenant.branding.subheadline}</p> : null}
          <div className="mt-10">
            <SearchForm branches={branches.map((b) => ({ id: b.id, name: b.name, timezone: b.timezone }))} lang={lang} />
          </div>
        </div>
      </section>

      {categories.length > 1 ? (
        <section className="container-page" aria-label={t("nav.fleet")}>
          <ul className="flex gap-2 overflow-x-auto pb-2">
            {categories.map((c) => (
              <li key={c}><Link href={`/fleet?category=${c}`} className="btn-ghost whitespace-nowrap px-4 py-2 text-sm">{t(`category.${c}`)}</Link></li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="container-page mt-12">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="font-display text-2xl font-bold md:text-3xl">{t("nav.fleet")}</h2>
          <Link href="/fleet" className="text-sm font-semibold text-brand hover:underline">{t("common.continue")} →</Link>
        </div>
        {fleet.length === 0 ? <p className="text-muted">{t("common.empty")}</p> : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {fleet.slice(0, 6).map((v, i) => <VehicleCard key={v.id} v={v} lang={lang} href={`/vehicles/${v.id}`} priority={i < 3} />)}
          </div>
        )}
      </section>

      {branches.length ? (
        <section className="container-page mt-20 grid gap-6 md:grid-cols-2">
          {branches.map((b) => (
            <article key={b.id} className="card p-6">
              <h3 className="font-display text-lg font-bold">{b.name}</h3>
              <p className="mt-1 text-sm text-muted">{b.address_line1}, {b.city}</p>
              {b.pickup_instructions ? <p className="mt-3 text-sm">{b.pickup_instructions}</p> : null}
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
