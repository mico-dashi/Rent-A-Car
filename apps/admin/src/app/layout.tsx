import type { Metadata } from "next";
import type { ReactNode } from "react";
import { buildTheme, DEFAULT_BRAND, themeToCssVars } from "@rental/design-tokens";
import { getLang } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Dashboard" },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  const vars = themeToCssVars(buildTheme(DEFAULT_BRAND, "dark"));
  return (
    <html lang={lang} data-theme="dark" style={vars as React.CSSProperties}>
      <body>{children}</body>
    </html>
  );
}
