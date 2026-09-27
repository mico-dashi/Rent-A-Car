import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { getT } from "@/lib/i18n";
import { isPlatformAdmin, requireUser } from "@/lib/session";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  await requireUser();
  if (!(await isPlatformAdmin())) notFound();
  const { t } = await getT();
  const items = [["", "overview"], ["/tenants", "tenants"], ["/plans", "plans"], ["/catalog", "catalog"], ["/system", "system"], ["/privacy", "privacy"], ["/audit", "audit"]]
    .map(([p, k]) => ({ href: `/platform${p}`, label: t(`admin.platform.nav.${k}`) }));
  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[232px_1fr]">
      <aside className="border-b border-line bg-surface p-4 md:border-b-0 md:border-r">
        <Link href="/" className="mb-4 flex items-center gap-2 font-display font-bold"><span aria-hidden className="inline-block h-5 w-1.5 rounded-full bg-brand" />{t("admin.home.platform")}</Link>
        <Nav items={items} />
        <form action="/auth/sign-out" method="post" className="mt-6 hidden md:block"><button className="text-xs text-muted hover:text-fg">{t("auth.signOut")}</button></form>
      </aside>
      <main className="mx-auto w-full max-w-[1280px] px-5 py-8 md:px-8">{children}</main>
    </div>
  );
}
