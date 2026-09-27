import { ActionForm } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { createVehicleAction } from "../actions";
import { VehicleFields } from "../vehicle-form";

export default async function NewVehicle({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "vehicles.write");
  const { t, lang } = await getT();
  const { data: branches } = await (await userClient()).from("branches").select("id,name").eq("tenant_id", ctx.tenantId).eq("is_active", true);
  return (
    <>
      <PageHeader title={t("admin.fleet.add")} />
      <Card><ActionForm action={createVehicleAction} lang={lang} submitLabel={t("admin.common.create")}><TenantFields slug={ctx.slug} /><VehicleFields branches={branches ?? []} lang={lang} /></ActionForm></Card>
    </>
  );
}
