import Link from "next/link";
import type { ReactNode } from "react";
import type { Permission } from "@rental/types";
import { Nav, type NavItem } from "@/components/nav";
import { Badge } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, myMemberships } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { setLanguage } from "@/app/actions";

const SECTIONS: [string, string, Permission][] = [
  ["", "overview", "tenant.read"],
  ["/today", "today", "bookings.read"],
  ["/bookings", "bookings", "bookings.read"],
  ["/calendar", "calendar", "bookings.read"],
  ["/fleet", "fleet", "vehicles.read"],
  ["/customers", "customers", "customers.read"],
  ["/branches", "branches", "branches.read"],
  ["/pricing", "pricing", "pricing.read"],
  ["/extras", "extras", "pricing.read"],
  ["/maintenance", "maintenance", "maintenance.read"],
  ["/damages", "damages", "damages.read"],
  ["/expenses", "expenses", "expenses.read"],
  ["/employees", "employees", "staff.read"],
  ["/payments", "payments", "payments.read"],
  ["/reports", "reports", "reports.read"],
  ["/messages", "messages", "messages.read"],
  ["/reviews", "reviews", "tenant.read"],
  ["/website", "website", "tenant.read"],
  ["/branding", "branding", "tenant.read"],
  ["/settings", "settings", "tenant.read"],
  ["/audit", "audit", "audit.read"],
];

export default async function TenantLayout({ children, params }: { children: ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ctx = await getTenantContext(tenant);
  const { t, lang } = await getT();
  const others = (await myMemberships()).filter((m) => m.tenant_slug !== ctx.slug);
  const { data: onboarding } = await (await userClient()).from("tenant_settings").select("onboarding_completed_at,onboarding_step").eq("tenant_id", ctx.tenantId).maybeSingle();
  const showOnboarding = can(ctx, "tenant.manage") && onboarding && !onboarding.onboarding_completed_at;
  const items: NavItem[] = SECTIONS.filter(([, , p]) => can(ctx, p)).map(([path, key]) => ({ href: `/t/${ctx.slug}${path}`, label: t(`admin.nav.${key}`) }));

  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[232px_1fr]">
      <aside className="border-b border-line bg-surface p-4 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="mb-4 flex items-center justify-between md:block">
          <Link href="/" className="flex items-center gap-2 font-display font-bold">
            <span aria-hidden className="inline-block h-5 w-1.5 rounded-full bg-brand" />
            <span className="truncate">{ctx.name}</span>
          </Link>
          <p className="mt-1 text-xs text-muted">{t(`admin.roles.${ctx.role}`)}</p>
        </div>
        <Nav items={items} />
        <div className="mt-6 hidden space-y-2 border-t border-line pt-4 text-xs md:block">
          {others.map((o) => <Link key={o.tenant_id} href={`/t/${o.tenant_slug}`} className="block text-muted hover:text-fg">↔ {o.tenant_name}</Link>)}
          {ctx.isPlatformAdmin ? <Link href="/platform" className="block text-muted hover:text-fg">{t("admin.home.platform")}</Link> : null}
          <form action={setLanguage}><input type="hidden" name="lang" value={lang === "en" ? "sq" : "en"} /><button className="text-muted hover:text-fg">{lang === "en" ? "Shqip" : "English"}</button></form>
          <form action="/auth/sign-out" method="post"><button className="text-muted hover:text-fg">{t("auth.signOut")}</button></form>
        </div>
      </aside>
      <div className="min-w-0">
        {ctx.status !== "ACTIVE" ? (
          <div role="status" className="border-b border-warn/40 bg-raised px-6 py-3 text-sm text-warn">
            <Badge status="PENDING_APPROVAL">{t(`admin.tenantStatus.${ctx.status}`)}</Badge> <span className="ml-2">{t(`admin.tenantStatusHelp.${ctx.status}`)}</span>
          </div>
        ) : null}
        {showOnboarding ? (
          <div className="border-b border-line bg-raised px-6 py-3 text-sm">
            {t("admin.onboarding.banner", { pct: Math.round(((onboarding.onboarding_step - 1) / 11) * 100) })} <Link className="ml-2 font-semibold text-brand underline" href={`/t/${ctx.slug}/onboarding`}>{t("admin.onboarding.resume")}</Link>
          </div>
        ) : null}
        <main className="mx-auto max-w-[1280px] px-5 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
