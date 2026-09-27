import { VEHICLE_CATEGORIES } from "@rental/types";
import { ActionForm, Field, Hidden, Select } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, Empty, PageHeader } from "@/components/ui";
import { money, toMajor } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { saveClassAction } from "../actions";

export default async function ClassesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "vehicles.read");
  const { t, lang } = await getT();
  const db = await userClient();
  const [{ data: classes }, { data: members }] = await Promise.all([
    db.from("vehicle_classes").select("*").eq("tenant_id", ctx.tenantId).order("rank"),
    db.from("vehicle_class_members").select("class_id").eq("tenant_id", ctx.tenantId),
  ]);
  const count = (id: string) => (members ?? []).filter((m) => m.class_id === id).length;
  const form = (c?: NonNullable<typeof classes>[number]) => (
    <ActionForm action={saveClassAction} lang={lang} submitLabel={c ? t("admin.common.save") : t("admin.common.create")} variant={c ? "ghost" : "primary"}>
      <TenantFields slug={ctx.slug} />{c ? <Hidden name="classId" value={c.id} /> : null}
      <div className="grid gap-3 md:grid-cols-4">
        <Field label={t("admin.fleet.classCode")} name="code" required defaultValue={c?.code} />
        <Field label={t("admin.common.name")} name="name" required defaultValue={c?.name} />
        <Select label={t("admin.fleet.fields.category")} name="category" required defaultValue={c?.category} options={VEHICLE_CATEGORIES.map((x) => ({ value: x, label: t(`category.${x}`) }))} />
        <Field label={t("admin.fleet.rank")} name="rank" type="number" defaultValue={c?.rank ?? 100} hint={t("admin.fleet.rankHint")} />
        <Field label={t("admin.fleet.equivalenceGroup")} name="equivalence_group" defaultValue={c?.equivalence_group} />
        <Field label={t("admin.fleet.fields.dailyRate")} name="daily_rate" required defaultValue={toMajor(c?.daily_rate_minor)} />
        <Field label={t("admin.fleet.fields.deposit")} name="deposit" defaultValue={toMajor(c?.deposit_minor ?? 0)} />
      </div>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title={t("admin.fleet.classes")} subtitle={t("admin.fleet.classesHint")} />
      <div className="space-y-6">
        {(classes ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (classes ?? []).map((c) => (
          <Card key={c.id} title={`${c.code} — ${c.name} (${count(c.id)})`} actions={<span className="text-sm text-muted">{money(c.daily_rate_minor, ctx.currency, lang)}</span>}>{can(ctx, "vehicles.write") ? form(c) : null}</Card>
        ))}
        {can(ctx, "vehicles.write") ? <Card title={t("admin.fleet.newClass")}>{form()}</Card> : null}
      </div>
    </>
  );
}
