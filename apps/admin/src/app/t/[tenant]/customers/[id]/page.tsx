import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Check, Field, Hidden, Select, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, Empty, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { d, dt, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { addCustomerNoteAction, addLicenseAction, restrictAction, setDocumentStatusAction, setIdentityAction, updateCustomerAction } from "../actions";
import { CustomerFields } from "../customer-form";

export default async function CustomerPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  requirePermission(ctx, "customers.read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t, lang } = await getT();
  const db = await userClient();
  const { data: c } = await db.from("customers").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!c) notFound();
  const path = `/t/${ctx.slug}/customers/${id}`;
  const [bookings, licenses, docs, restrictions, notes] = await Promise.all([
    can(ctx, "bookings.read") ? db.from("bookings").select("id,reference,status,starts_at,total_minor,amount_paid_minor,amount_refunded_minor").eq("customer_id", id).order("starts_at", { ascending: false }) : Promise.resolve({ data: [] }),
    can(ctx, "customers.documents") ? db.from("driver_licenses").select("*").eq("customer_id", id).order("expires_on", { ascending: false }) : Promise.resolve({ data: [] }),
    can(ctx, "customers.documents") ? db.from("customer_documents").select("*").eq("customer_id", id) : Promise.resolve({ data: [] }),
    db.from("customer_restrictions").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    db.from("customer_notes").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
  ]);
  const live = (bookings.data ?? []).filter((b) => !["CANCELLED", "NO_SHOW", "DRAFT", "QUOTE"].includes(b.status));
  const lifetime = live.reduce((a, b) => a + Number(b.total_minor), 0);
  const outstanding = (bookings.data ?? []).filter((b) => ["ACTIVE", "RETURN_DUE", "RETURNED", "COMPLETED", "DISPUTED"].includes(b.status))
    .reduce((a, b) => a + Math.max(0, Number(b.total_minor) - (Number(b.amount_paid_minor) - Number(b.amount_refunded_minor))), 0);
  const docHref = (bucket: string, p: string) => `/t/${ctx.slug}/documents?bucket=${bucket}&path=${encodeURIComponent(p)}`;

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name}`} subtitle={c.email} actions={<>
        {c.is_restricted ? <Badge status="CANCELLED">{t("admin.customers.restricted")}</Badge> : null}
        <Badge status={c.identity_status === "VERIFIED" ? "CONFIRMED" : "PENDING_APPROVAL"}>{t(`admin.verification.${c.identity_status}`)}</Badge>
        {can(ctx, "bookings.write") && !c.is_restricted ? <LinkButton href={`/t/${ctx.slug}/bookings/new?customer=${c.id}`}>{t("admin.bookings.new")}</LinkButton> : null}
        {can(ctx, "messages.write") ? <LinkButton variant="ghost" href={`/t/${ctx.slug}/messages/new?customer=${c.id}`}>{t("admin.messages.contact")}</LinkButton> : null}
      </>} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t("admin.customers.bookings")} value={live.length} />
        <Stat label={t("admin.customers.lifetime")} value={money(lifetime, ctx.currency, lang)} />
        <Stat label={t("admin.customers.outstanding")} value={money(outstanding, ctx.currency, lang)} tone={outstanding > 0 ? "warn" : undefined} />
        <Stat label={t("admin.customers.since")} value={d(c.created_at, ctx.timezone, lang)} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title={t("admin.customers.profile")}>
            {can(ctx, "customers.write") ? (
              <ActionForm action={updateCustomerAction} lang={lang} submitLabel={t("admin.common.save")}><TenantFields slug={ctx.slug} path={path} /><Hidden name="customerId" value={c.id} /><CustomerFields c={c} lang={lang} /></ActionForm>
            ) : <p className="text-sm">{c.phone} · {c.address_line1} {c.city}</p>}
          </Card>
          {can(ctx, "bookings.read") ? (
            <Card title={t("admin.nav.bookings")}>
              {(bookings.data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
                <Table head={[t("admin.bookings.reference"), t("admin.bookings.pickup"), t("admin.common.status"), t("common.total")]}>
                  {(bookings.data ?? []).map((b) => <tr key={b.id}><td><Link className="text-brand hover:underline" href={`/t/${ctx.slug}/bookings/${b.id}`}>{b.reference}</Link></td><td>{dt(b.starts_at, ctx.timezone, lang)}</td><td><Badge status={b.status}>{t(`booking.status.${b.status}`)}</Badge></td><td className="tabular-nums">{money(b.total_minor, ctx.currency, lang)}</td></tr>)}
                </Table>
              )}
            </Card>
          ) : null}
          {can(ctx, "customers.documents") ? (
            <Card title={t("admin.customers.documents")}>
              {(licenses.data ?? []).length === 0 && (docs.data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : null}
              <ul className="space-y-3 text-sm">
                {(licenses.data ?? []).map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-3">
                    <span>{t("documents.license")} {l.license_number} ({l.issuing_country}) · {t("admin.pickup.expires")} {d(l.expires_on, ctx.timezone, lang)}</span>
                    <Badge status={l.verification_status === "VERIFIED" ? "CONFIRMED" : l.verification_status === "REJECTED" ? "CANCELLED" : "PENDING_APPROVAL"}>{t(`admin.verification.${l.verification_status}`)}</Badge>
                    {l.front_image_path ? <a className="text-brand underline" href={docHref("customer-documents", l.front_image_path)}>{t("admin.pickup.front")}</a> : null}
                    {l.back_image_path ? <a className="text-brand underline" href={docHref("customer-documents", l.back_image_path)}>{t("admin.pickup.back")}</a> : null}
                    {l.verification_status !== "VERIFIED" ? ["VERIFIED", "REJECTED"].map((s) => (
                      <ActionForm key={s} action={setDocumentStatusAction} lang={lang} submitLabel={t(`admin.verification.action.${s}`)} variant={s === "REJECTED" ? "danger" : "ghost"} className="inline-flex">
                        <TenantFields slug={ctx.slug} path={path} /><Hidden name="documentId" value={l.id} /><Hidden name="table" value="driver_licenses" /><Hidden name="status" value={s} /></ActionForm>)) : null}
                  </li>
                ))}
                {(docs.data ?? []).map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-3">
                    <span>{t(`admin.customers.docKinds.${x.kind}`)}</span><Badge>{t(`admin.verification.${x.verification_status}`)}</Badge>
                    <a className="text-brand underline" href={docHref("customer-documents", x.storage_path)}>{t("admin.common.open")}</a>
                    {x.verification_status !== "VERIFIED" ? ["VERIFIED", "REJECTED"].map((s) => (
                      <ActionForm key={s} action={setDocumentStatusAction} lang={lang} submitLabel={t(`admin.verification.action.${s}`)} variant="ghost" className="inline-flex">
                        <TenantFields slug={ctx.slug} path={path} /><Hidden name="documentId" value={x.id} /><Hidden name="table" value="customer_documents" /><Hidden name="status" value={s} /></ActionForm>)) : null}
                  </li>
                ))}
              </ul>
              <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">{t("admin.pickup.addLicense")}</summary>
                <ActionForm action={addLicenseAction} lang={lang} submitLabel={t("admin.common.add")} className="mt-3 space-y-3" resetOnSuccess>
                  <TenantFields slug={ctx.slug} path={path} /><Hidden name="customerId" value={c.id} />
                  <div className="grid gap-3 md:grid-cols-4">
                    <Field label={t("documents.license")} name="license_number" required />
                    <Field label={t("admin.customers.fields.country")} name="issuing_country" required pattern="[A-Za-z]{2}" />
                    <Field label={t("admin.fleet.issued")} name="issued_on" type="date" />
                    <Field label={t("admin.fleet.expires")} name="expires_on" type="date" required />
                  </div>
                  <div className="flex flex-wrap gap-6 text-sm"><label>{t("admin.pickup.front")} <input type="file" name="front" accept="image/jpeg,image/png,image/heic,application/pdf" /></label>
                    <label>{t("admin.pickup.back")} <input type="file" name="back" accept="image/jpeg,image/png,image/heic,application/pdf" /></label></div>
                  <Check label={t("admin.customers.verifiedInPerson")} name="verified" />
                </ActionForm>
              </details>
              <div className="mt-4 border-t border-line pt-4">
                <p className="label">{t("admin.customers.identity")}</p>
                <div className="flex flex-wrap gap-2">{["VERIFIED", "REJECTED", "PENDING"].filter((s) => s !== c.identity_status).map((s) => (
                  <ActionForm key={s} action={setIdentityAction} lang={lang} submitLabel={t(`admin.verification.set.${s}`)} variant="ghost" className="inline-flex"><TenantFields slug={ctx.slug} path={path} /><Hidden name="customerId" value={c.id} /><Hidden name="status" value={s} /></ActionForm>))}</div>
              </div>
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
          <Card title={t("admin.customers.restrictions")}>
            {can(ctx, "customers.restrict") ? (
              <ActionForm action={restrictAction} lang={lang} submitLabel={t("admin.common.save")} confirm={t("admin.customers.restrictConfirm")} resetOnSuccess>
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="customerId" value={c.id} />
                <Select label={t("admin.common.action")} name="action" required options={(c.is_restricted ? ["LIFT"] : ["RESTRICT", "BLACKLIST"]).map((a) => ({ value: a, label: t(`admin.customers.restrictActions.${a}`) }))} />
                <TextArea label={t("admin.common.reason")} name="reason" rows={2} required />
              </ActionForm>
            ) : null}
            <ol className="mt-4 space-y-2 text-sm">{(restrictions.data ?? []).map((r) => <li key={r.id}><Badge status={r.action === "LIFT" ? "CONFIRMED" : "CANCELLED"}>{t(`admin.customers.restrictActions.${r.action}`)}</Badge> <span className="text-xs text-muted">{dt(r.created_at, ctx.timezone, lang)}</span><p>{r.reason}</p></li>)}</ol>
          </Card>
          <Card title={t("admin.bookings.notes")}>
            {can(ctx, "customers.write") ? (
              <ActionForm action={addCustomerNoteAction} lang={lang} submitLabel={t("admin.common.add")} resetOnSuccess>
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="customerId" value={c.id} /><TextArea label={t("admin.bookings.note")} name="body" rows={2} required />
              </ActionForm>
            ) : null}
            <ul className="mt-4 space-y-2 text-sm">{(notes.data ?? []).map((n) => <li key={n.id} className="rounded-md bg-raised p-3"><p className="whitespace-pre-line">{n.body}</p><p className="text-xs text-muted">{dt(n.created_at, ctx.timezone, lang)}</p></li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  );
}
