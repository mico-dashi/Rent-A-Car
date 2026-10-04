import type { Metadata } from "next";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";
import { tenantLegalText } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy" } };

export default async function PrivacyPage() {
  const tenant = await getTenant();
  const { t } = await getT(tenant.language);
  const doc = await tenantLegalText(tenant.id, "privacy");
  return (
    <article className="container-page max-w-3xl pt-14">
      <h1 className="font-display text-4xl font-black">{t("nav.privacy")}</h1>
      <p className="mt-2 text-xs text-muted">v{doc.version}</p>
      {doc.body ? <div className="mt-8 whitespace-pre-line leading-relaxed text-muted">{doc.body}</div>
        : <p className="mt-8 text-muted">{tenant.displayName} has not published this document yet. Please contact us for details.</p>}
    </article>
  );
}
