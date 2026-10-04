import Link from "next/link";
import { TENANT_STATUSES } from "@rental/types";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { d } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { userClient } from "@/lib/supabase/server";

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { t, lang } = await getT();
  const sp = await searchParams;
  let q = (await userClient()).from("tenants").select("id,slug,display_name,status,country_code,base_currency,created_at").order("created_at", { ascending: false }).limit(500);
  if (sp.status && (TENANT_STATUSES as readonly string[]).includes(sp.status)) q = q.eq("status", sp.status as never);
  if (sp.q) { const s = sp.q.replace(/[%,()]/g, ""); q = q.or(`display_name.ilike.%${s}%,slug.ilike.%${s}%,legal_name.ilike.%${s}%`); }
  const { data } = await q;
  return (
    <>
      <PageHeader title={t("admin.platform.nav.tenants")} />
      <Card>
        <form method="get" className="mb-4 flex gap-3"><input name="q" defaultValue={sp.q ?? ""} className="field py-2" aria-label={t("admin.common.search")} placeholder={t("admin.common.search")} />
          <select name="status" defaultValue={sp.status ?? ""} className="field py-2" aria-label={t("admin.common.status")}><option value="">{t("admin.common.all")}</option>{TENANT_STATUSES.map((s) => <option key={s} value={s}>{t(`admin.tenantStatus.${s}`)}</option>)}</select>
          <button className="btn-ghost px-4 py-2 text-sm">{t("admin.common.apply")}</button></form>
        <Table head={[t("admin.common.name"), "Slug", t("admin.common.status"), t("admin.customers.fields.country"), t("admin.onboarding.currency"), t("admin.common.date")]}>
          {(data ?? []).map((x) => <tr key={x.id}><td><Link className="font-semibold text-brand hover:underline" href={`/platform/tenants/${x.id}`}>{x.display_name}</Link></td><td>{x.slug}</td><td><Badge>{t(`admin.tenantStatus.${x.status}`)}</Badge></td><td>{x.country_code}</td><td>{x.base_currency}</td><td>{d(x.created_at, "UTC", lang)}</td></tr>)}
        </Table>
      </Card>
    </>
  );
}
