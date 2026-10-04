import type { Metadata } from "next";
import { listBranches } from "@rental/api-client";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";
import { publicClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Contact", alternates: { canonical: "/contact" } };

export default async function ContactPage() {
  const tenant = await getTenant();
  const { t } = await getT(tenant.language);
  const branches = await listBranches(publicClient(), tenant.id);
  const b = tenant.branding;
  return (
    <div className="container-page pt-14">
      <h1 className="font-display text-4xl font-black">{t("nav.contact")}</h1>
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <div className="card p-6 text-sm">
          {b.contactPhone ? <p><a className="text-lg font-semibold hover:text-brand" href={`tel:${b.contactPhone.replace(/\s/g, "")}`}>{b.contactPhone}</a></p> : null}
          {b.contactEmail ? <p className="mt-2"><a className="hover:text-brand" href={`mailto:${b.contactEmail}`}>{b.contactEmail}</a></p> : null}
          {b.contactAddress ? <p className="mt-2 text-muted">{b.contactAddress}</p> : null}
        </div>
        {branches.map((br) => (
          <div key={br.id} className="card p-6 text-sm">
            <h2 className="font-display text-lg font-bold">{br.name}</h2>
            <p className="mt-1 text-muted">{br.address_line1}, {br.city}</p>
            {br.phone ? <p className="mt-2"><a href={`tel:${br.phone.replace(/\s/g, "")}`} className="hover:text-brand">{br.phone}</a></p> : null}
            {br.latitude !== null && br.longitude !== null ? (
              <a className="mt-3 inline-block text-brand underline" rel="noopener noreferrer" target="_blank"
                href={`https://www.google.com/maps/search/?api=1&query=${br.latitude},${br.longitude}`}>Map ↗</a>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
