import Link from "next/link";
import { notFound } from "next/navigation";
import { DAMAGE_STATUSES } from "@rental/types";
import { ActionForm, Field, Hidden, Select } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, DL, PageHeader } from "@/components/ui";
import { dt, money, toMajor } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { decideDamageAction, markVehicleDamagedAction, reviewAiAction } from "../actions";

export default async function DamagePage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  requirePermission(ctx, "damages.read");
  const { t, lang } = await getT();
  const db = await userClient();
  const { data: x } = await db.from("vehicle_damages").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!x) notFound();
  const path = `/t/${ctx.slug}/damages/${id}`;
  const [{ data: v }, { data: photos }, { data: ai }] = await Promise.all([
    db.from("vehicles").select("id,make,model,registration_plate,status").eq("id", x.vehicle_id).single(),
    x.inspection_id ? db.from("inspection_photos").select("id,slot,storage_path").eq("inspection_id", x.inspection_id) : Promise.resolve({ data: [] }),
    x.inspection_id ? db.from("damage_ai_assessments").select("*").eq("return_inspection_id", x.inspection_id) : Promise.resolve({ data: [] }),
  ]);
  return (
    <>
      <PageHeader title={t(`admin.damages.types.${x.damage_type}`)} subtitle={`${v?.make} ${v?.model} · ${v?.registration_plate}`} actions={<Badge>{t(`admin.damages.statuses.${x.status}`)}</Badge>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <DL items={[[t("admin.damages.location"), x.location], [t("admin.damages.description"), x.description], [t("admin.common.date"), dt(x.discovered_at, ctx.timezone, lang)],
              [t("admin.damages.responsibility"), x.responsibility ? t(`admin.damages.resp.${x.responsibility}`) : "—"], [t("admin.damages.estimated"), money(x.estimated_cost_minor, ctx.currency, lang)],
              [t("admin.damages.actual"), money(x.actual_cost_minor, ctx.currency, lang)], [t("admin.damages.decided"), x.decided_at ? dt(x.decided_at, ctx.timezone, lang) : "—"],
              [t("admin.nav.bookings"), x.booking_id ? <Link key="b" className="text-brand hover:underline" href={`/t/${ctx.slug}/bookings/${x.booking_id}`}>{t("admin.common.open")}</Link> : "—"]]} />
          </Card>
          <Card title={t("admin.inspections.photos")}>
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">{(photos ?? []).map((p) => <li key={p.id}><a className="text-sm text-brand underline" href={`/t/${ctx.slug}/documents?bucket=inspection-photos&path=${encodeURIComponent(p.storage_path)}`}>{t(`admin.inspections.slots.${p.slot}`)}</a></li>)}</ul>
          </Card>
          {(ai ?? []).length ? (
            <Card title={t("admin.damages.aiTitle")}>
              <p className="mb-3 text-xs text-muted">{t("admin.damages.aiAdvisory")}</p>
              {(ai ?? []).map((a) => (
                <div key={a.id} className="mb-3 text-sm">
                  <p>{a.model} {a.model_version} · {t("admin.damages.confidence")} {a.max_confidence !== null ? `${Math.round(Number(a.max_confidence) * 100)}%` : "—"} · <Badge>{a.review_status}</Badge></p>
                  {a.review_status === "PENDING_REVIEW" && can(ctx, "damages.manage") ? ["CONFIRMED", "DISMISSED"].map((dcs) => (
                    <ActionForm key={dcs} action={reviewAiAction} lang={lang} submitLabel={t(`admin.damages.ai.${dcs}`)} variant="ghost" className="mr-2 inline-flex"><TenantFields slug={ctx.slug} path={path} /><Hidden name="assessmentId" value={a.id} /><Hidden name="decision" value={dcs} /></ActionForm>)) : null}
                </div>
              ))}
            </Card>
          ) : null}
        </div>
        {can(ctx, "damages.manage") ? (
          <div className="space-y-6">
            <Card title={t("admin.damages.decide")}>
              <ActionForm action={decideDamageAction} lang={lang} submitLabel={t("admin.common.save")} confirm={t("admin.damages.decideConfirm")}>
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="damageId" value={x.id} />
                <Select label={t("admin.common.status")} name="status" required defaultValue={x.status} options={DAMAGE_STATUSES.map((s) => ({ value: s, label: t(`admin.damages.statuses.${s}`) }))} />
                <Select label={t("admin.damages.responsibility")} name="responsibility" defaultValue={x.responsibility} options={["CUSTOMER", "COMPANY", "INSURANCE", "THIRD_PARTY", "UNDETERMINED"].map((r) => ({ value: r, label: t(`admin.damages.resp.${r}`) }))} />
                <Field label={t("admin.damages.estimated")} name="estimated" defaultValue={toMajor(x.estimated_cost_minor)} />
                <Field label={t("admin.damages.actual")} name="actual" defaultValue={toMajor(x.actual_cost_minor)} />
                <p className="text-xs text-muted">{t("admin.damages.chargeHint")}</p>
              </ActionForm>
            </Card>
            {v && v.status !== "DAMAGED" && can(ctx, "vehicles.status") ? (
              <Card><ActionForm action={markVehicleDamagedAction} lang={lang} submitLabel={t("admin.damages.takeOutOfService")} variant="danger" confirm={t("admin.common.confirm")}><TenantFields slug={ctx.slug} path={path} /><Hidden name="vehicleId" value={v.id} /></ActionForm></Card>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
