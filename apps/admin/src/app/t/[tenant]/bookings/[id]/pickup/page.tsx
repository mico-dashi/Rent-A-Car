import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Hidden } from "@/components/forms";
import { SignaturePad } from "@/components/signature-pad";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, PageHeader } from "@/components/ui";
import { d, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { transitionAction, depositAction } from "../../actions";
import { InspectionSection, type InspectionRow } from "../inspection-form";
import { generateAgreementAction, signAction, verifyLicenseAction } from "../operations";

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 flex items-center gap-3 font-display font-bold">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${done ? "bg-ok text-bg" : "bg-raised text-muted"}`}>{done ? "✓" : n}</span>{title}
      </h2>
      {children}
    </section>
  );
}

export default async function PickupPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  requirePermission(ctx, "inspections.perform");
  const { t, lang } = await getT();
  const db = await userClient();
  const { data: b } = await db.from("bookings").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!b) notFound();
  const path = `/t/${ctx.slug}/bookings/${id}/pickup`;
  const [{ data: licenses }, { data: vehicle }, { data: insp }, { data: agreement }, { data: deposit }, { data: settings }] = await Promise.all([
    db.from("driver_licenses").select("*").eq("customer_id", b.customer_id).order("expires_on", { ascending: false }),
    b.vehicle_id ? db.from("vehicles").select("make,model,registration_plate,odometer_km,fuel_type").eq("id", b.vehicle_id).single() : Promise.resolve({ data: null }),
    db.from("vehicle_inspections").select("*").eq("booking_id", id).eq("kind", "PICKUP").maybeSingle(),
    db.from("rental_agreements").select("id,status,pdf_path").eq("booking_id", id).neq("status", "VOID").maybeSingle(),
    db.from("security_deposits").select("status,amount_minor").eq("booking_id", id).maybeSingle(),
    db.from("tenant_settings").select("payment_timing").eq("tenant_id", ctx.tenantId).single(),
  ]);
  const { data: photos } = insp ? await db.from("inspection_photos").select("id,slot").eq("inspection_id", insp.id) : { data: [] };
  const { data: sigs } = agreement ? await db.from("signatures").select("signer_role").eq("agreement_id", agreement.id) : { data: [] };
  const licenseOk = (licenses ?? []).some((l) => l.verification_status === "VERIFIED" && l.expires_on >= b.ends_at.slice(0, 10));
  const paid = b.payment_status === "PAID" || settings?.payment_timing === "PAY_AT_PICKUP";
  const depositOk = Number(b.deposit_minor) === 0 || deposit?.status === "AUTHORIZED" || deposit?.status === "NOT_REQUIRED";
  const inspectionOk = Boolean(insp && insp.status !== "DRAFT" && insp.customer_accepted_at);
  const signedCustomer = (sigs ?? []).some((s) => s.signer_role === "CUSTOMER");
  const signedEmployee = (sigs ?? []).some((s) => s.signer_role === "EMPLOYEE");
  const ready = licenseOk && paid && depositOk && inspectionOk && agreement?.status === "FULLY_SIGNED";

  if (!vehicle) {
    return <><PageHeader title={t("admin.pickup.title")} /><Card><p className="text-warn">{t("errors.VEHICLE_NOT_ASSIGNED") !== "errors.VEHICLE_NOT_ASSIGNED" ? t("errors.VEHICLE_NOT_ASSIGNED") : t("errors.VEHICLE_NOT_ASSIGNED")}</p><Link className="mt-3 inline-block text-brand" href={`/t/${ctx.slug}/bookings/${id}`}>{b.reference}</Link></Card></>;
  }

  return (
    <>
      <PageHeader title={`${t("admin.pickup.title")} — ${b.reference}`} subtitle={`${vehicle.make} ${vehicle.model} · ${vehicle.registration_plate}`}
        actions={<Link href={`/t/${ctx.slug}/bookings/${id}`} className="btn-ghost px-4 py-2 text-sm">← {t("admin.common.back")}</Link>} />
      <div className="space-y-4">
        <Step n={1} done={licenseOk} title={t("admin.pickup.identity")}>
          {(licenses ?? []).length === 0 ? <p className="text-sm text-warn">{t("admin.pickup.noLicense")} <Link className="text-brand underline" href={`/t/${ctx.slug}/customers/${b.customer_id}`}>{t("admin.pickup.addLicense")}</Link></p> : (
            <ul className="space-y-3">{(licenses ?? []).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>{l.license_number} · {l.issuing_country} · {t("admin.pickup.expires")} {d(l.expires_on, ctx.timezone, lang)}</span>
                <Badge status={l.verification_status === "VERIFIED" ? "CONFIRMED" : "PENDING_APPROVAL"}>{t(`admin.verification.${l.verification_status}`)}</Badge>
                {l.front_image_path ? <a className="text-brand underline" href={`/t/${ctx.slug}/documents?bucket=customer-documents&path=${encodeURIComponent(l.front_image_path)}`}>{t("admin.pickup.front")}</a> : null}
                {l.back_image_path ? <a className="text-brand underline" href={`/t/${ctx.slug}/documents?bucket=customer-documents&path=${encodeURIComponent(l.back_image_path)}`}>{t("admin.pickup.back")}</a> : null}
                {can(ctx, "customers.documents") && l.verification_status !== "VERIFIED" ? (
                  <ActionForm action={verifyLicenseAction} lang={lang} submitLabel={t("admin.pickup.verify")} variant="ghost" className="flex items-center gap-2">
                    <TenantFields slug={ctx.slug} path={path} /><Hidden name="licenseId" value={l.id} /><Hidden name="status" value="VERIFIED" />
                  </ActionForm>) : null}
              </li>))}</ul>
          )}
        </Step>
        <Step n={2} done={paid} title={t("admin.pickup.payment")}>
          <p className="text-sm">{t(`admin.paymentStatus.${b.payment_status}`)} · {money(Number(b.total_minor) - Number(b.amount_paid_minor) + Number(b.amount_refunded_minor), ctx.currency, lang)} {t("admin.bookings.balance").toLowerCase()}</p>
          {!paid ? <Link className="mt-2 inline-block text-sm text-brand underline" href={`/t/${ctx.slug}/bookings/${id}`}>{t("admin.pickup.takePayment")}</Link> : null}
        </Step>
        <Step n={3} done={depositOk} title={t("pricing.deposit")}>
          <p className="text-sm">{deposit ? `${t(`admin.deposit.${deposit.status}`)} · ${money(deposit.amount_minor, ctx.currency, lang)}` : t("admin.deposit.NOT_REQUIRED")}</p>
          {deposit && !depositOk && can(ctx, "deposits.manage") ? (
            <ActionForm action={depositAction} lang={lang} submitLabel={t("admin.deposit.authorize")} variant="ghost" className="mt-2"><TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={id} /><Hidden name="op" value="authorize" /></ActionForm>
          ) : null}
        </Step>
        <InspectionSection kind="PICKUP" slug={ctx.slug} path={path} bookingId={id} inspection={insp as InspectionRow | null} photos={photos ?? []}
          isElectric={vehicle.fuel_type === "ELECTRIC"} lang={lang} minOdometer={vehicle.odometer_km} />
        <Step n={5} done={agreement?.status === "FULLY_SIGNED"} title={t("admin.bookings.agreement")}>
          {can(ctx, "agreements.manage") ? (
            <ActionForm action={generateAgreementAction} lang={lang} submitLabel={agreement ? t("admin.pickup.regenerate") : t("admin.pickup.generate")} variant="ghost" className="mb-4">
              <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={id} />
            </ActionForm>
          ) : null}
          {agreement ? (
            <>
              <p className="mb-4 text-sm"><Badge>{t(`admin.agreement.${agreement.status}`)}</Badge> {agreement.pdf_path ? <a className="ml-2 text-brand underline" href={`/t/${ctx.slug}/documents?path=${encodeURIComponent(agreement.pdf_path)}`}>PDF</a> : null}</p>
              <div className="grid gap-6 lg:grid-cols-2">
                {!signedCustomer ? <SignaturePad lang={lang} label={t("admin.pickup.customerSignature")} action={signAction} hidden={{ _tenant: ctx.slug, _path: path, agreementId: agreement.id, role: "CUSTOMER" }} /> : <p className="text-sm text-ok">✓ {t("admin.pickup.customerSignature")}</p>}
                {!signedEmployee ? <SignaturePad lang={lang} label={t("admin.pickup.employeeSignature")} action={signAction} hidden={{ _tenant: ctx.slug, _path: path, agreementId: agreement.id, role: "EMPLOYEE" }} /> : <p className="text-sm text-ok">✓ {t("admin.pickup.employeeSignature")}</p>}
              </div>
            </>
          ) : null}
        </Step>
        <Card>
          {b.status !== "READY_FOR_PICKUP" && b.status !== "ACTIVE" ? (
            <ActionForm action={transitionAction} lang={lang} submitLabel={t("admin.transitions.READY_FOR_PICKUP")} variant="ghost" className="mb-3">
              <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={id} /><Hidden name="to" value="READY_FOR_PICKUP" />
            </ActionForm>
          ) : null}
          {b.status === "READY_FOR_PICKUP" ? (
            <ActionForm action={transitionAction} lang={lang} submitLabel={t("admin.pickup.handOver")}>
              <TenantFields slug={ctx.slug} path={`/t/${ctx.slug}/bookings/${id}`} /><Hidden name="bookingId" value={id} /><Hidden name="to" value="ACTIVE" />
              {!ready ? <p className="text-sm text-warn">{t("admin.pickup.notReady")}</p> : null}
            </ActionForm>
          ) : b.status === "ACTIVE" ? <p className="text-ok">{t("booking.status.ACTIVE")}</p> : null}
        </Card>
      </div>
    </>
  );
}
