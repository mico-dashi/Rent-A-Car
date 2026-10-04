import Link from "next/link";
import { notFound } from "next/navigation";
import { priceLineLabel } from "@rental/localization";
import { ActionForm, Hidden } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { transitionAction } from "../../actions";
import { InspectionSection, type InspectionRow } from "../inspection-form";
import { confirmChargesAction, proposeReturnCharges } from "../operations";

export default async function ReturnPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  requirePermission(ctx, "inspections.perform");
  const { t, lang } = await getT();
  const db = await userClient();
  const { data: b } = await db.from("bookings").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!b || !b.vehicle_id) notFound();
  const path = `/t/${ctx.slug}/bookings/${id}/return`;
  const [{ data: vehicle }, { data: insp }, { data: pickup }] = await Promise.all([
    db.from("vehicles").select("make,model,registration_plate,odometer_km,fuel_type").eq("id", b.vehicle_id).single(),
    db.from("vehicle_inspections").select("*").eq("booking_id", id).eq("kind", "RETURN").maybeSingle(),
    db.from("vehicle_inspections").select("odometer_km").eq("booking_id", id).eq("kind", "PICKUP").maybeSingle(),
  ]);
  const { data: photos } = insp ? await db.from("inspection_photos").select("id,slot").eq("inspection_id", insp.id) : { data: [] };
  const proposal = insp && insp.status !== "DRAFT" ? await proposeReturnCharges(ctx.tenantId, id) : null;
  const { data: postLines } = await db.from("booking_price_lines").select("id").eq("booking_id", id).eq("is_post_rental", true);
  const balance = Number(b.total_minor) - (Number(b.amount_paid_minor) - Number(b.amount_refunded_minor));

  return (
    <>
      <PageHeader title={`${t("admin.return.title")} — ${b.reference}`} subtitle={`${vehicle!.make} ${vehicle!.model} · ${vehicle!.registration_plate}`}
        actions={<Link href={`/t/${ctx.slug}/bookings/${id}`} className="btn-ghost px-4 py-2 text-sm">← {t("admin.common.back")}</Link>} />
      <div className="space-y-4">
        <InspectionSection kind="RETURN" slug={ctx.slug} path={path} bookingId={id} inspection={insp as InspectionRow | null} photos={photos ?? []}
          isElectric={vehicle!.fuel_type === "ELECTRIC"} lang={lang} minOdometer={pickup?.odometer_km ?? vehicle!.odometer_km} />
        {proposal ? (
          <Card title={t("admin.return.proposedCharges")}>
            {"error" in proposal ? <p className="text-sm text-bad" role="alert">{t("admin.return.implausible")}</p> : (
              <>
                <p className="mb-3 text-sm text-muted">{t("admin.return.summary", { km: proposal.distanceKm, late: proposal.lateMinutes })}</p>
                {proposal.lines.length === 0 ? <p className="text-sm text-ok">{t("admin.return.noCharges")}</p> : (postLines ?? []).length ? <p className="text-sm text-ok">{t("admin.return.chargesAdded")}</p> : can(ctx, "payments.charge") ? (
                  <ActionForm action={confirmChargesAction} lang={lang} submitLabel={t("admin.return.confirmCharges")} confirm={t("admin.return.confirmChargesQ")}>
                    <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={id} />
                    <ul className="space-y-2">{proposal.lines.map((l, i) => (
                      <li key={i}><label className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><input type="checkbox" name="line" value={i} defaultChecked className="accent-[var(--color-primary)]" />{priceLineLabel(lang, l.label, l.labelParams, l.quantity)}</span><span className="tabular-nums">{money(l.amountMinor, ctx.currency, lang)}</span></label></li>
                    ))}</ul>
                    <p className="text-xs text-muted">{t("admin.return.humanConfirm")}</p>
                  </ActionForm>
                ) : null}
              </>
            )}
          </Card>
        ) : null}
        <Card>
          <p className="mb-3 text-sm">{t("admin.bookings.balance")}: <strong>{money(balance, ctx.currency, lang)}</strong> — <Link className="text-brand underline" href={`/t/${ctx.slug}/bookings/${id}`}>{t("admin.return.settle")}</Link></p>
          {b.status === "ACTIVE" || b.status === "RETURN_DUE" ? (
            <ActionForm action={transitionAction} lang={lang} submitLabel={t("admin.return.markReturned")}>
              <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={id} /><Hidden name="to" value="RETURNED" />
            </ActionForm>
          ) : b.status === "RETURNED" ? (
            <ActionForm action={transitionAction} lang={lang} submitLabel={t("admin.return.complete")} confirm={balance > 0 ? t("admin.return.completeWithBalance") : undefined}>
              <TenantFields slug={ctx.slug} path={`/t/${ctx.slug}/bookings/${id}`} /><Hidden name="bookingId" value={id} /><Hidden name="to" value="COMPLETED" />
            </ActionForm>
          ) : null}
        </Card>
      </div>
    </>
  );
}
