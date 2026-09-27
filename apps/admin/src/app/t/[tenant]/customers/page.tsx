import Link from "next/link";
import { Badge, Card, Empty, LinkButton, PageHeader, Pager, Table } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

const PAGE = 30;
export default async function CustomersPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ q?: string; page?: string; restricted?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "customers.read");
  const { t } = await getT();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  let q = (await userClient()).from("customers").select("id,first_name,last_name,email,phone,identity_status,is_restricted,created_at").eq("tenant_id", ctx.tenantId)
    .order("last_name").range(page * PAGE, page * PAGE + PAGE);
  if (sp.q) { const s = sp.q.replace(/[%,()]/g, ""); q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`); }
  if (sp.restricted === "1") q = q.eq("is_restricted", true);
  const { data } = await q;
  const rows = (data ?? []).slice(0, PAGE);
  return (
    <>
      <PageHeader title={t("admin.nav.customers")} actions={can(ctx, "customers.write") ? <LinkButton href={`/t/${ctx.slug}/customers/new`}>{t("admin.customers.add")}</LinkButton> : null} />
      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1"><label className="label" htmlFor="q">{t("admin.common.search")}</label><input id="q" name="q" defaultValue={sp.q ?? ""} className="field py-2" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restricted" value="1" defaultChecked={sp.restricted === "1"} className="accent-[var(--color-primary)]" />{t("admin.customers.restrictedOnly")}</label>
          <button className="btn-ghost px-4 py-2 text-sm">{t("admin.common.apply")}</button>
        </form>
        {rows.length === 0 ? <Empty>{t("common.empty")}</Empty> : (
          <Table head={[t("admin.common.name"), t("auth.email"), t("admin.customers.fields.phone"), t("admin.customers.identity"), ""]}>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><Link className="font-semibold text-brand hover:underline" href={`/t/${ctx.slug}/customers/${c.id}`}>{c.last_name}, {c.first_name}</Link></td>
                <td>{c.email}</td><td>{c.phone ?? "—"}</td>
                <td><Badge status={c.identity_status === "VERIFIED" ? "CONFIRMED" : "PENDING_APPROVAL"}>{t(`admin.verification.${c.identity_status}`)}</Badge></td>
                <td>{c.is_restricted ? <Badge status="CANCELLED">{t("admin.customers.restricted")}</Badge> : null}</td>
              </tr>
            ))}
          </Table>
        )}
        <Pager page={page} hasMore={(data ?? []).length > PAGE} href={(p) => `?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) })}`} />
      </Card>
    </>
  );
}
