import { Card, Empty, PageHeader, Pager, Table } from "@/components/ui";
import { dt } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

const PAGE = 50;
function diff(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>, a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !["updated_at", "version"].includes(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  return keys.slice(0, 6).map((k) => `${k}: ${JSON.stringify(b[k] ?? null)} → ${JSON.stringify(a[k] ?? null)}`).join("; ").slice(0, 300);
}

export default async function AuditPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ resource?: string; page?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "audit.read");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  let q = (await userClient()).from("audit_logs").select("*").eq("tenant_id", ctx.tenantId).order("id", { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
  if (sp.resource) q = q.eq("resource_type", sp.resource);
  const { data } = await q;
  const rows = (data ?? []).slice(0, PAGE);
  return (
    <>
      <PageHeader title={t("admin.nav.audit")} subtitle={t("admin.audit.subtitle")} />
      <Card>
        <form method="get" className="mb-4 flex gap-3"><input name="resource" defaultValue={sp.resource ?? ""} placeholder="bookings, vehicles, memberships…" className="field py-2" aria-label={t("admin.audit.resource")} /><button className="btn-ghost px-4 py-2 text-sm">{t("admin.common.apply")}</button></form>
        {rows.length === 0 ? <Empty>{t("common.empty")}</Empty> : (
          <Table head={[t("admin.common.date"), t("admin.audit.actor"), t("admin.common.action"), t("admin.audit.resource"), t("admin.audit.changes")]}>
            {rows.map((r) => <tr key={r.id}><td className="whitespace-nowrap text-xs">{dt(r.created_at, ctx.timezone, lang)}</td><td className="text-xs">{r.actor_kind}{r.actor_id ? ` ${r.actor_id.slice(0, 8)}` : ""}{r.ip_address ? <span className="block text-muted">{r.ip_address}</span> : null}</td>
              <td className="text-xs">{r.action}</td><td className="text-xs">{r.resource_type}<span className="block text-muted">{r.resource_id?.slice(0, 8)}</span></td><td className="max-w-md break-words text-xs text-muted">{diff(r.before_state, r.after_state)}</td></tr>)}
          </Table>
        )}
        <Pager page={page} hasMore={(data ?? []).length > PAGE} href={(p) => `?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) })}`} />
      </Card>
    </>
  );
}
