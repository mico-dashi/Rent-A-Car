import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Hidden, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { dt } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { closeThreadAction, replyAction } from "../actions";

export default async function ThreadPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  requirePermission(ctx, "messages.read");
  const { t, lang } = await getT();
  const db = await userClient();
  const { data: th } = await db.from("message_threads").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!th) notFound();
  const [{ data: msgs }, { data: c }] = await Promise.all([
    db.from("messages").select("*").eq("thread_id", id).order("created_at"),
    db.from("customers").select("id,first_name,last_name").eq("id", th.customer_id).single(),
  ]);
  const path = `/t/${ctx.slug}/messages/${id}`;
  return (
    <>
      <PageHeader title={th.subject ?? t(`admin.messages.kinds.${th.kind}`)} subtitle={`${c?.first_name} ${c?.last_name}`} actions={<>
        {th.booking_id ? <Link className="btn-ghost px-4 py-2 text-sm" href={`/t/${ctx.slug}/bookings/${th.booking_id}`}>{t("admin.nav.bookings")}</Link> : null}
        {can(ctx, "messages.write") ? <ActionForm action={closeThreadAction} lang={lang} submitLabel={th.status === "OPEN" ? t("admin.messages.close") : t("admin.messages.reopen")} variant="ghost" className="flex"><TenantFields slug={ctx.slug} path={path} /><Hidden name="threadId" value={id} /><Hidden name="status" value={th.status === "OPEN" ? "CLOSED" : "OPEN"} /></ActionForm> : null}</>} />
      <Card>
        <ol className="space-y-3" aria-live="polite">{(msgs ?? []).map((m) => (
          <li key={m.id} className={`max-w-[80%] rounded-lg p-3 text-sm ${m.sender_kind === "STAFF" ? "ml-auto bg-raised" : m.sender_kind === "SYSTEM" ? "mx-auto text-center text-xs text-muted" : "border border-line"}`}>
            {m.body ? <p className="whitespace-pre-line">{m.body}</p> : null}
            {m.attachment_paths.map((p) => <a key={p} className="mr-2 text-xs text-brand underline" href={`/t/${ctx.slug}/documents?bucket=message-attachments&path=${encodeURIComponent(p)}`}>📎</a>)}
            <p className="mt-1 text-xs text-muted">{t(`admin.messages.sender.${m.sender_kind}`)} · {dt(m.created_at, ctx.timezone, lang)}</p>
          </li>))}</ol>
        {can(ctx, "messages.write") && th.status === "OPEN" ? (
          <ActionForm action={replyAction} lang={lang} submitLabel={t("admin.messages.send")} className="mt-6 space-y-3" resetOnSuccess>
            <TenantFields slug={ctx.slug} path={path} /><Hidden name="threadId" value={id} />
            <TextArea label={t("admin.messages.reply")} name="body" rows={3} maxLength={5000} />
            <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple aria-label={t("admin.inspections.photos")} className="text-sm" />
          </ActionForm>
        ) : null}
      </Card>
    </>
  );
}
