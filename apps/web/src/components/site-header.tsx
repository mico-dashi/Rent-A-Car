import Link from "next/link";
import { createTranslator } from "@rental/localization";
import type { LanguageCode, ResolvedTenant } from "@rental/types";
import { mediaUrl } from "@/lib/media";
import { LanguageSwitch } from "./language-switch";

export function SiteHeader({ tenant, lang }: { tenant: ResolvedTenant; lang: LanguageCode }) {
  const t = createTranslator(lang);
  const logo = mediaUrl(tenant.branding.logoDarkPath ?? tenant.branding.logoPath, "tenant-branding");
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[color-mix(in_srgb,var(--color-background)_82%,transparent)] backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 truncate font-display text-base font-bold tracking-tight md:text-lg">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={tenant.displayName} className="h-8 w-auto" />
          ) : (
            <>
              <span aria-hidden className="inline-block h-6 w-1.5 rounded-full bg-brand" />
              {tenant.displayName}
            </>
          )}
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-sm font-medium text-muted md:flex">
          <Link className="hover:text-fg" href="/fleet">{t("nav.fleet")}</Link>
          <Link className="hover:text-fg" href="/about">{t("nav.about")}</Link>
          <Link className="hover:text-fg" href="/faq">{t("nav.faq")}</Link>
          <Link className="hover:text-fg" href="/contact">{t("nav.contact")}</Link>
        </nav>
        <div className="flex items-center gap-3">
          <LanguageSwitch current={lang} />
          <Link href="/account/bookings" className="btn-ghost whitespace-nowrap px-3 py-2 text-xs md:px-4 md:text-sm">{t("nav.myBookings")}</Link>
        </div>
      </div>
    </header>
  );
}
