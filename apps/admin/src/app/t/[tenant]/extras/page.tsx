import { EXTRA_BILLINGS } from "@rental/types";
import type { Tables } from "@rental/database";
import { ActionForm, Check, Field, Hidden, Select } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { money, toMajor } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { saveExtraAction } from "./actions";

export default async function ExtrasPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "pricing.read");
  const { t, lang } = await getT();
  const { data: extras } = await (await userClient()).from("extras").select("*").eq("tenant_id", ctx.tenantId).order("sort_order");
  const edit = can(ctx, "extras.manage");
  const form = (e?: Tables<"extras">) => (
    <ActionForm action={saveExtraAction} lang={lang} submitLabel={e ? t("admin.common.save") : t("admin.common.create")} variant={e ? "ghost" : "primary"}>
      <TenantFields slug={ctx.slug} />{e ? <Hidden name="extraId" value={e.id} /> : null}
      <div className="grid gap-3 md:grid-cols-4">
        <Field label={t("admin.pricing.code")} name="code" required defaultValue={e?.code} pattern="[a-z0-9_]+" />
        <Field label={t("admin.common.name")} name="name" required defaultValue={e?.name} />
        <Select label={t("admin.common.type")} name="kind" required defaultValue={e?.kind ?? "EXTRA"} options={[{ value: "EXTRA", label: t("admin.extras.extra") }, { value: "INSURANCE", label: t("admin.extras.insurance") }]} />
        <Select label={t("admin.extras.billing")} name="billing" required defaultValue={e?.billing ?? "PER_DAY"} options={EXTRA_BILLINGS.map((b) => ({ value: b, label: t(`admin.extras.billings.${b}`) }))} />
        <Field label={t("admin.extras.price")} name="price" defaultValue={toMajor(e?.price_minor ?? 0)} />
        <Field label={t("admin.extras.cap")} name="max_price" defaultValue={toMajor(e?.max_price_minor)} />
        <Field label={t("admin.extras.maxQty")} name="max_quantity" type="number" min={1} max={20} defaultValue={e?.max_quantity ?? 1} />
        <Field label={t("admin.extras.depositReduction")} name="deposit_reduction" type="number" min={0} max={100} defaultValue={(e?.deposit_reduction_bps ?? 0) / 100} />
        <Field label={t("admin.customers.fields.description")} name="description" defaultValue={e?.description} />
        <Field label={t("admin.extras.sort")} name="sort_order" type="number" defaultValue={e?.sort_order ?? 0} />
      </div>
      <Check label={t("admin.common.active")} name="is_active" defaultChecked={e?.is_active ?? true} />
    </ActionForm>
  );
  return (
    <>
      <PageHeader title={t("admin.nav.extras")} />
      <div className="space-y-4">
        {(extras ?? []).map((e) => <Card key={e.id} title={`${e.name} — ${e.billing === "FREE" ? t("admin.extras.billings.FREE") : money(e.price_minor, ctx.currency, lang)}`}>{edit ? form(e) : null}</Card>)}
        {edit ? <Card title={t("admin.extras.add")}>{form()}</Card> : null}
      </div>
    </>
  );
}
