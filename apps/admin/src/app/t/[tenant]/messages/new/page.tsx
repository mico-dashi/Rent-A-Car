import { ActionForm, Field, Hidden, Select, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { newThreadAction } from "../actions";

export default async function NewThread({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ customer?: string; booking?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "messages.write");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const { data: customers } = await (await userClient()).from("customers").select("id,first_name,last_name,email").eq("tenant_id", ctx.tenantId).order("last_name").limit(500);
  return (
    <>
      <PageHeader title={t("admin.messages.new")} />
      <Card>
        <ActionForm action={newThreadAction} lang={lang} submitLabel={t("admin.messages.send")}>
          <TenantFields slug={ctx.slug} />{sp.booking ? <Hidden name="bookingId" value={sp.booking} /> : null}
          <Select label={t("admin.bookings.customer")} name="customerId" required defaultValue={sp.customer ?? null} options={(customers ?? []).map((c) => ({ value: c.id, label: `${c.last_name}, ${c.first_name} — ${c.email}` }))} />
          {!sp.booking ? <Select label={t("admin.common.type")} name="kind" required options={["GENERAL", "SUPPORT"].map((k) => ({ value: k, label: t(`admin.messages.kinds.${k}`) }))} /> : null}
          <Field label={t("admin.messages.subject")} name="subject" required />
          <TextArea label={t("admin.messages.message")} name="body" rows={5} required maxLength={5000} />
        </ActionForm>
      </Card>
    </>
  );
}
