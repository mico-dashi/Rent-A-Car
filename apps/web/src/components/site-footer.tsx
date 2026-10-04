import Link from "next/link";
import { createTranslator } from "@rental/localization";
import type { LanguageCode, ResolvedTenant } from "@rental/types";

export function SiteFooter({ tenant, lang }: { tenant: ResolvedTenant; lang: LanguageCode }) {
  const t = createTranslator(lang);
  const b = tenant.branding;
  return (
    <footer className="mt-24 border-t border-line">
      <div className="container-page grid gap-10 py-14 text-sm text-muted md:grid-cols-3">
        <div>
          <p className="font-display text-base font-bold text-fg">{tenant.displayName}</p>
          {b.contactAddress ? <p className="mt-2">{b.contactAddress}</p> : null}
          {b.contactPhone ? <p><a href={`tel:${b.contactPhone.replace(/\s/g, "")}`} className="hover:text-fg">{b.contactPhone}</a></p> : null}
          {b.contactEmail ? <p><a href={`mailto:${b.contactEmail}`} className="hover:text-fg">{b.contactEmail}</a></p> : null}
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-2">
          <Link href="/fleet" className="hover:text-fg">{t("nav.fleet")}</Link>
          <Link href="/about" className="hover:text-fg">{t("nav.about")}</Link>
          <Link href="/faq" className="hover:text-fg">{t("nav.faq")}</Link>
          <Link href="/contact" className="hover:text-fg">{t("nav.contact")}</Link>
          <Link href="/terms" className="hover:text-fg">{t("nav.terms")}</Link>
          <Link href="/privacy" className="hover:text-fg">{t("nav.privacy")}</Link>
        </nav>
        <div className="md:text-right">
          {Object.entries(b.socialLinks ?? {}).map(([name, url]) => (
            <a key={name} href={url} rel="noopener noreferrer" target="_blank" className="mr-4 capitalize hover:text-fg md:ml-4 md:mr-0">{name}</a>
          ))}
          {!b.hidePlatformBranding ? <p className="mt-4 text-xs opacity-60">Powered by {process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Rental Platform"}</p> : null}
        </div>
      </div>
    </footer>
  );
}
