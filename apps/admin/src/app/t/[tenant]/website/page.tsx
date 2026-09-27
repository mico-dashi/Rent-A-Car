import { ActionForm, Field, Hidden, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { dt } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { addDomainAction, removeDomainAction, saveContentAction, saveLegalAction, setPrimaryDomainAction } from "./actions";

export default async function WebsitePage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "tenant.read");
  const { t, lang } = await getT();
  const db = await userClient();
  const [{ data: b }, { data: s }, { data: domains }] = await Promise.all([
    db.from("tenant_branding").select("*").eq("tenant_id", ctx.tenantId).single(),
    db.from("tenant_settings").select("legal_terms_md,legal_privacy_md,legal_policy_version").eq("tenant_id", ctx.tenantId).single(),
    db.from("tenant_domains").select("*").eq("tenant_id", ctx.tenantId).order("created_at"),
  ]);
  const faq = ((b?.faq ?? []) as { q: string; a: string }[]).concat([{ q: "", a: "" }, { q: "", a: "" }]);
  const social = (b?.social_links ?? {}) as Record<string, string>;
  const primary = (domains ?? []).find((d) => d.is_primary);
  return (
    <>
      <PageHeader title={t("admin.nav.website")} subtitle={primary ? `https://${primary.hostname}` : undefined}
        actions={primary ? <a className="btn-ghost px-4 py-2 text-sm" href={`https://${primary.hostname}`} target="_blank" rel="noopener noreferrer">{t("admin.website.view")} ↗</a> : null} />
      <div className="space-y-6">
        <Card title={t("admin.website.content")}>
          <ActionForm action={saveContentAction} lang={lang} submitLabel={t("admin.common.save")}>
            <TenantFields slug={ctx.slug} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("admin.website.headline")} name="headline" defaultValue={b?.headline} />
              <Field label={t("admin.website.subheadline")} name="subheadline" defaultValue={b?.subheadline} />
              <Field label={t("auth.email")} name="contact_email" type="email" defaultValue={b?.contact_email} />
              <Field label={t("admin.customers.fields.phone")} name="contact_phone" defaultValue={b?.contact_phone} />
              <Field label={t("admin.customers.fields.address")} name="contact_address" defaultValue={b?.contact_address} />
            </div>
            <TextArea label={t("admin.website.about")} name="about_md" defaultValue={b?.about_md} rows={5} />
            <fieldset className="grid gap-3 md:grid-cols-3"><legend className="label">{t("admin.website.social")}</legend>
              {["instagram", "facebook", "tiktok", "x", "youtube", "linkedin"].map((k) => <Field key={k} label={k} name={`social_${k}`} type="url" defaultValue={social[k]} placeholder="https://" />)}</fieldset>
            <fieldset className="space-y-3"><legend className="label">{t("nav.faq")}</legend>
              {faq.map((f, i) => <div key={i} className="grid gap-2 md:grid-cols-2"><input name="faq_q" defaultValue={f.q} placeholder={t("admin.website.question")} aria-label={t("admin.website.question")} className="field py-2" /><input name="faq_a" defaultValue={f.a} placeholder={t("admin.website.answer")} aria-label={t("admin.website.answer")} className="field py-2" /></div>)}
            </fieldset>
          </ActionForm>
        </Card>
        <Card title={t("admin.website.domains")}>
          <Table head={[t("admin.website.hostname"), t("admin.common.status"), t("admin.website.dns"), ""]}>
            {(domains ?? []).map((d) => (
              <tr key={d.id}>
                <td>{d.hostname}{d.is_primary ? <Badge status="CONFIRMED">{t("admin.website.primary")}</Badge> : null}</td>
                <td><Badge status={d.status === "VERIFIED" ? "CONFIRMED" : d.status === "FAILED" ? "CANCELLED" : "PENDING_APPROVAL"}>{t(`admin.website.domainStatus.${d.status}`)}</Badge>{d.last_checked_at ? <span className="block text-xs text-muted">{dt(d.last_checked_at, ctx.timezone, lang)}</span> : null}</td>
                <td className="text-xs">{d.is_platform_subdomain ? t("admin.website.managed") : d.status === "VERIFIED" ? "—" : (
                  <div className="space-y-1 font-mono"><p>CNAME {d.hostname} → cname.{process.env.NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN ?? "platform"}</p><p className="break-all">TXT _rental-verify.{d.hostname} = {d.verification_token}</p></div>)}</td>
                <td className="flex gap-1">{can(ctx, "domains.manage") && d.status === "VERIFIED" && !d.is_primary ? <ActionForm action={setPrimaryDomainAction} lang={lang} submitLabel={t("admin.website.makePrimary")} variant="ghost" className="inline-flex"><TenantFields slug={ctx.slug} /><Hidden name="domainId" value={d.id} /></ActionForm> : null}
                  {can(ctx, "domains.manage") && !d.is_platform_subdomain && !d.is_primary ? <ActionForm action={removeDomainAction} lang={lang} submitLabel="×" variant="danger" className="inline-flex" confirm={t("admin.common.confirmDelete")}><TenantFields slug={ctx.slug} /><Hidden name="domainId" value={d.id} /></ActionForm> : null}</td>
              </tr>
            ))}
          </Table>
          {can(ctx, "domains.manage") ? (
            <ActionForm action={addDomainAction} lang={lang} submitLabel={t("admin.website.addDomain")} variant="ghost" className="mt-4 flex flex-wrap items-end gap-3">
              <TenantFields slug={ctx.slug} /><Field label={t("admin.website.hostname")} name="hostname" required placeholder="rentals.example.com" />
            </ActionForm>
          ) : null}
          <p className="mt-3 text-xs text-muted">{t("admin.website.domainHelp")}</p>
        </Card>
        <Card title={`${t("admin.website.legal")} (v${s?.legal_policy_version ?? "1"})`}>
          {can(ctx, "tenant.manage") ? (
            <ActionForm action={saveLegalAction} lang={lang} submitLabel={t("admin.common.save")}>
              <TenantFields slug={ctx.slug} />
              <TextArea label={t("nav.terms")} name="terms" defaultValue={s?.legal_terms_md} rows={8} />
              <TextArea label={t("nav.privacy")} name="privacy" defaultValue={s?.legal_privacy_md} rows={8} />
              <p className="text-xs text-muted">{t("admin.website.legalHint")}</p>
            </ActionForm>
          ) : null}
        </Card>
      </div>
    </>
  );
}
