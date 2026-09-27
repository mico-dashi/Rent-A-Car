import { Card, PageHeader, Pager, Table } from "@/components/ui";
import { dt } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { userClient } from "@/lib/supabase/server";

const PAGE = 100;
export default async function PlatformAudit({ searchParams }: { searchParams: Promise<{ page?: string; actor?: string }> }) {
  const { t, lang } = await getT();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  let q = (await userClient()).from("audit_logs").select("id,created_at,tenant_id,actor_kind,actor_id,action,resource_type,resource_id,ip_address").order("id", { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
  if (sp.actor === "PLATFORM_ADMIN") q = q.eq("actor_kind", "PLATFORM_ADMIN");
  const { data } = await q;
  return (
    <>
      <PageHeader title={t("admin.platform.nav.audit")} actions={<a className="btn-ghost px-4 py-2 text-sm" href={`?actor=${sp.actor === "PLATFORM_ADMIN" ? "" : "PLATFORM_ADMIN"}`}>{t("admin.platform.adminActionsOnly")}</a>} />
      <Card>
        <Table head={[t("admin.common.date"), t("admin.platform.tenant"), t("admin.audit.actor"), t("admin.common.action"), t("admin.audit.resource")]}>
          {(data ?? []).slice(0, PAGE).map((r) => <tr key={r.id}><td className="text-xs">{dt(r.created_at, "UTC", lang)}</td><td className="text-xs">{r.tenant_id?.slice(0, 8) ?? "—"}</td><td className="text-xs">{r.actor_kind} {r.actor_id?.slice(0, 8)}</td><td className="text-xs">{r.action}</td><td className="text-xs">{r.resource_type} {r.resource_id?.slice(0, 8)}</td></tr>)}
        </Table>
        <Pager page={page} hasMore={(data ?? []).length > PAGE} href={(p) => `?page=${p}${sp.actor ? `&actor=${sp.actor}` : ""}`} />
      </Card>
    </>
  );
}
