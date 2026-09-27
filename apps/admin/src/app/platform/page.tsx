import Link from "next/link";
import { ActionForm, Hidden } from "@/components/forms";
import { Badge, Card, Empty, PageHeader, Stat, Table } from "@/components/ui";
import { money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { userClient } from "@/lib/supabase/server";
import { setTenantStatusAction } from "./actions";
import type { CurrencyCode } from "@rental/types";

interface Overview {
  tenantsByStatus: Record<string, number>; mrrMinor: number; bookings30d: number; gmv30dByCurrency: Record<string, number>; platformFees30dMinor: number;
  failedPayments7d: number; failedWebhooks: number; failedNotifications: number; pendingApprovals: number; pendingDomains: number; pendingPrivacyRequests: number;
  tenantHealth: { tenantId: string; name: string; slug: string; status: string; vehicles: number; bookings30d: number; failedPayments7d: number; paymentsConnected: boolean; onboardingStep: number }[];
}

export default async function PlatformOverview() {
  const { t, lang } = await getT();
  const db = await userClient();
  const { data } = await db.rpc("platform_overview");
  const o = data as unknown as Overview;
  const { data: pending } = await db.from("tenants").select("id,display_name,slug,country_code,created_at").eq("status", "PENDING_APPROVAL").order("created_at");
  return (
    <>
      <PageHeader title={t("admin.platform.overview")} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t("admin.platform.activeTenants")} value={o.tenantsByStatus.ACTIVE ?? 0} hint={`${o.tenantsByStatus.SUSPENDED ?? 0} ${t("admin.tenantStatus.SUSPENDED").toLowerCase()}`} />
        <Stat label="MRR" value={money(o.mrrMinor, "EUR", lang)} />
        <Stat label={t("admin.platform.bookings30d")} value={o.bookings30d} />
        <Stat label={t("admin.platform.fees30d")} value={money(o.platformFees30dMinor, "EUR", lang)} hint={Object.entries(o.gmv30dByCurrency).map(([c, v]) => `GMV ${money(v, c as CurrencyCode, lang)}`).join(" · ")} />
        <Stat label={t("admin.platform.failedPayments")} value={o.failedPayments7d} tone={o.failedPayments7d ? "bad" : undefined} />
        <Stat label={t("admin.platform.failedWebhooks")} value={o.failedWebhooks} tone={o.failedWebhooks ? "bad" : undefined} />
        <Stat label={t("admin.platform.failedNotifications")} value={o.failedNotifications} tone={o.failedNotifications ? "warn" : undefined} />
        <Stat label={t("admin.platform.pending")} value={`${o.pendingApprovals} / ${o.pendingDomains} / ${o.pendingPrivacyRequests}`} hint={t("admin.platform.pendingHint")} />
      </div>
      <Card title={t("admin.platform.approvals")} className="mt-6">
        {(pending ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
          <ul className="divide-y divide-line">{(pending ?? []).map((tn) => (
            <li key={tn.id} className="flex items-center justify-between gap-3 py-3 text-sm"><Link className="text-brand hover:underline" href={`/platform/tenants/${tn.id}`}>{tn.display_name}</Link><span className="text-muted">{tn.slug} · {tn.country_code}</span>
              <ActionForm action={setTenantStatusAction} lang={lang} submitLabel={t("admin.platform.approve")} className="flex"><Hidden name="tenantId" value={tn.id} /><Hidden name="status" value="ACTIVE" /></ActionForm></li>))}</ul>
        )}
      </Card>
      <Card title={t("admin.platform.health")} className="mt-6">
        <Table head={[t("admin.common.name"), t("admin.common.status"), t("admin.nav.fleet"), t("admin.platform.bookings30d"), t("admin.platform.failedPayments"), t("admin.nav.payments"), t("admin.platform.onboarding")]}>
          {o.tenantHealth.map((h) => <tr key={h.tenantId}><td><Link className="text-brand hover:underline" href={`/platform/tenants/${h.tenantId}`}>{h.name}</Link></td><td><Badge>{t(`admin.tenantStatus.${h.status}`)}</Badge></td><td>{h.vehicles}</td><td>{h.bookings30d}</td>
            <td className={h.failedPayments7d ? "text-bad" : ""}>{h.failedPayments7d}</td><td>{h.paymentsConnected ? "✓" : "—"}</td><td>{Math.min(11, h.onboardingStep)}/11</td></tr>)}
        </Table>
      </Card>
    </>
  );
}
