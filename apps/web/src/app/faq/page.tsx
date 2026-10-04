import type { Metadata } from "next";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = { title: "FAQ", alternates: { canonical: "/faq" } };

export default async function FaqPage() {
  const tenant = await getTenant();
  const { t } = await getT(tenant.language);
  const faq = tenant.branding.faq ?? [];
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  return (
    <div className="container-page max-w-3xl pt-14">
      {faq.length ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} /> : null}
      <h1 className="font-display text-4xl font-black">{t("nav.faq")}</h1>
      <div className="mt-8 space-y-3">
        {faq.length === 0 ? <p className="text-muted">{t("common.empty")}</p> : faq.map((f, i) => (
          <details key={i} className="card group p-5">
            <summary className="cursor-pointer list-none font-semibold">{f.q}</summary>
            <p className="mt-3 text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
