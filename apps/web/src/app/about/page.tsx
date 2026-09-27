import type { Metadata } from "next";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = { title: "About", alternates: { canonical: "/about" } };

export default async function AboutPage() {
  const tenant = await getTenant();
  const { t } = await getT(tenant.language);
  return (
    <article className="container-page max-w-3xl pt-14">
      <h1 className="font-display text-4xl font-black">{t("nav.about")}</h1>
      <div className="mt-6 whitespace-pre-line text-lg leading-relaxed text-muted">{tenant.branding.aboutMd ?? tenant.displayName}</div>
    </article>
  );
}
