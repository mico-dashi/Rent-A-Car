import Link from "next/link";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { dt } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

export default async function MessagesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ status?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "messages.read");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const db = await userClient();
  const { data: threads } = await db.from("message_threads").select("*").eq("tenant_id", ctx.tenantId).eq("status", sp.status === "CLOSED" ? "CLOSED" : "OPEN").order("last_message_at", { ascending: false, nullsFirst: false }).limit(100);
  const cIds = [...new Set((threads ?? []).map((x) => x.customer_id))];
  const { data: cs } = cIds.length ? await db.from("customers").select("id,first_name,last_name").in("id", cIds) : { data: [] };
  const cm = new Map((cs ?? []).map((c) => [c.id, `${c.first_name} ${c.last_name}`]));
  return (
    <>
      <PageHeader title={t("admin.nav.messages")} actions={<>
        <LinkButton variant="ghost" href={`?status=${sp.status === "CLOSED" ? "OPEN" : "CLOSED"}`}>{sp.status === "CLOSED" ? t("admin.messages.open") : t("admin.messages.closed")}</LinkButton>
        {can(ctx, "messages.write") ? <LinkButton href={`/t/${ctx.slug}/messages/new`}>{t("admin.messages.new")}</LinkButton> : null}</>} />
      <Card>
        {(threads ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
          <ul className="divide-y divide-line">{(threads ?? []).map((th) => (
            <li key={th.id}><Link href={`/t/${ctx.slug}/messages/${th.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-brand">
              <span><strong>{th.subject ?? t(`admin.messages.kinds.${th.kind}`)}</strong><span className="block text-sm text-muted">{cm.get(th.customer_id)}</span></span>
              <span className="text-right text-xs text-muted"><Badge>{t(`admin.messages.kinds.${th.kind}`)}</Badge><br />{dt(th.last_message_at ?? th.created_at, ctx.timezone, lang)}</span></Link></li>))}</ul>
        )}
      </Card>
    </>
  );
}
