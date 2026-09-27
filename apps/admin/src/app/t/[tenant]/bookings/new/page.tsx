import { randomUUID } from "node:crypto";
import { ActionForm, Field, Select, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { createBookingAction } from "../actions";

export default async function NewBooking({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ customer?: string; vehicle?: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "bookings.write");
  const { t, lang } = await getT();
  const sp = await searchParams;
  const db = await userClient();
  const [{ data: customers }, { data: vehicles }, { data: branches }, { data: extras }] = await Promise.all([
    db.from("customers").select("id,first_name,last_name,email").eq("tenant_id", ctx.tenantId).eq("is_restricted", false).order("last_name").limit(500),
    db.from("vehicles").select("id,make,model,registration_plate,branch_id").eq("tenant_id", ctx.tenantId).not("status", "in", "(SOLD,INACTIVE,DAMAGED)").order("make"),
    db.from("branches").select("id,name").eq("tenant_id", ctx.tenantId).eq("is_active", true).order("name"),
    db.from("extras").select("id,name").eq("tenant_id", ctx.tenantId).eq("is_active", true).order("sort_order"),
  ]);
  return (
    <>
      <PageHeader title={t("admin.bookings.new")} subtitle={t("admin.bookings.newHint")} />
      <Card>
        <ActionForm action={createBookingAction} lang={lang} submitLabel={t("admin.bookings.create")}>
          <TenantFields slug={ctx.slug} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <div className="grid gap-4 md:grid-cols-2">
            <Select label={t("admin.bookings.customer")} name="customerId" required defaultValue={sp.customer ?? null}
              options={(customers ?? []).map((c) => ({ value: c.id, label: `${c.last_name}, ${c.first_name} — ${c.email}` }))} />
            <Select label={t("admin.bookings.vehicle")} name="vehicleId" required defaultValue={sp.vehicle ?? null}
              options={(vehicles ?? []).map((v) => ({ value: v.id, label: `${v.make} ${v.model} · ${v.registration_plate}` }))} />
            <Select label={t("search.pickupLocation")} name="pickupBranchId" required options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
            <Select label={t("search.returnLocation")} name="returnBranchId" options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
            <Field label={`${t("search.pickupDate")} (${ctx.timezone})`} name="start" type="datetime-local" required />
            <Field label={`${t("search.returnDate")} (${ctx.timezone})`} name="end" type="datetime-local" required />
            <Select label={t("admin.common.status")} name="status" required defaultValue="CONFIRMED"
              options={[{ value: "CONFIRMED", label: t("admin.bookings.statusPayAtPickup") }, { value: "PENDING_PAYMENT", label: t("booking.status.PENDING_PAYMENT") }]} />
            <Field label={t("checkout.promoCode")} name="discountCode" />
          </div>
          {extras?.length ? (
            <fieldset><legend className="label">{t("checkout.extras")}</legend>
              <div className="flex flex-wrap gap-4">{extras.map((e) => <label key={e.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="extras" value={e.id} className="accent-[var(--color-primary)]" />{e.name}</label>)}</div>
            </fieldset>
          ) : null}
          <TextArea label={t("admin.bookings.customerNotes")} name="notes" rows={2} maxLength={1000} />
        </ActionForm>
      </Card>
    </>
  );
}
