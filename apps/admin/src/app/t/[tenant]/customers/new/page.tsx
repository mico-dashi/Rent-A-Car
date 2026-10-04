import { ActionForm } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { getTenantContext, requirePermission } from "@/lib/session";
import { createCustomerAction } from "../actions";
import { CustomerFields } from "../customer-form";

export default async function NewCustomer({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "customers.write");
  const { t, lang } = await getT();
  return <><PageHeader title={t("admin.customers.add")} /><Card><ActionForm action={createCustomerAction} lang={lang} submitLabel={t("admin.common.create")}><TenantFields slug={ctx.slug} /><CustomerFields lang={lang} /></ActionForm></Card></>;
}
