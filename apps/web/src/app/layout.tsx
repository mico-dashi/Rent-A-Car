import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { buildTheme, DEFAULT_BRAND, themeToCssVars } from "@rental/design-tokens";
import { getTenantOrNull } from "@/lib/tenant";
import { getLanguage } from "@/lib/i18n";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantOrNull();
  const name = tenant?.displayName ?? "Car rental";
  const base = tenant?.primaryHostname ? `https://${tenant.primaryHostname}` : undefined;
  return {
    title: { default: name, template: `%s · ${name}` },
    description: tenant?.branding.subheadline ?? undefined,
    ...(base ? { metadataBase: new URL(base), alternates: { canonical: "/" } } : {}),
    openGraph: { siteName: name, type: "website" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const tenant = await getTenantOrNull();
  return { themeColor: tenant?.branding.backgroundColor ?? DEFAULT_BRAND.backgroundColor, colorScheme: "dark light" };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenantOrNull();
  const lang = await getLanguage(tenant?.language ?? "en");
  const brand = tenant?.branding ?? DEFAULT_BRAND;
  const scheme = tenant?.branding.defaultTheme === "light" ? "light" : "dark";
  const vars = themeToCssVars(buildTheme(brand, scheme));
  const fonts = tenant ? { "--font-heading": `"${tenant.branding.fontHeading}", ui-sans-serif, system-ui, sans-serif`, "--font-body": `"${tenant.branding.fontBody}", ui-sans-serif, system-ui, sans-serif` } : {};

  return (
    <html lang={lang} data-theme={scheme} style={{ ...vars, ...fonts } as React.CSSProperties}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 btn-primary">Skip to content</a>
        {tenant ? <SiteHeader tenant={tenant} lang={lang} /> : null}
        <main id="main">{children}</main>
        {tenant ? <SiteFooter tenant={tenant} lang={lang} /> : null}
      </body>
    </html>
  );
}
