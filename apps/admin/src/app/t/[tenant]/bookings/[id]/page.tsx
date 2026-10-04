import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BOOKING_TRANSITIONS, utcToZonedLocal } from "@rental/domain";
import type { BookingStatus, Permission } from "@rental/types";
import { priceLineLabel } from "@rental/localization";
import { ActionForm, Field, Hidden, Select, TextArea, Check } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, DL, Empty, PageHeader, Table } from "@/components/ui";
import { dt, money, toMajor } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission, type TenantContext } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { addNoteAction, assignVehicleAction, chargeBalanceAction, depositAction, invoiceAction, modifyDatesAction, recordPaymentAction, refundAction, transitionAction } from "../actions";

function transitionPermission(to: BookingStatus): Permission {
  return to === "CANCELLED" ? "bookings.cancel" : to === "NO_SHOW" || to === "DISPUTED" ? "bookings.cancel" : "bookings.write";
}

export default async function BookingDetail({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const ctx: TenantContext = await getTenantContext(tenant);
  requirePermission(ctx, "bookings.read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t, lang } = await getT();
  const db = await userClient();
  const { data: b } = await db.from("bookings").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!b) notFound();
  const path = `/t/${ctx.slug}/bookings/${id}`;
  const [cust, veh, lines, notes, history, pays, refunds, deposit, agreement, invoices, inspections, damages, branches, candidates] = await Promise.all([
    db.from("customers").select("id,first_name,last_name,email,phone,is_restricted,identity_status").eq("id", b.customer_id).single(),
    b.vehicle_id ? db.from("vehicles").select("id,make,model,registration_plate,status").eq("id", b.vehicle_id).single() : Promise.resolve({ data: null }),
    db.from("booking_price_lines").select("*").eq("booking_id", id).order("sort_order"),
    db.from("booking_notes").select("*").eq("booking_id", id).order("created_at", { ascending: false }),
    db.from("booking_status_history").select("*").eq("booking_id", id).order("id", { ascending: false }),
    can(ctx, "payments.read") ? db.from("payments").select("*").eq("booking_id", id).order("created_at") : Promise.resolve({ data: [] }),
    can(ctx, "payments.read") ? db.from("refunds").select("*").eq("booking_id", id).order("created_at") : Promise.resolve({ data: [] }),
    can(ctx, "payments.read") ? db.from("security_deposits").select("*").eq("booking_id", id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("rental_agreements").select("id,status,pdf_path,generated_at,fully_signed_at").eq("booking_id", id).neq("status", "VOID").maybeSingle(),
    can(ctx, "payments.read") ? db.from("invoices").select("id,number,kind,total_minor,pdf_path,issued_at").eq("booking_id", id).order("issued_at") : Promise.resolve({ data: [] }),
    db.from("vehicle_inspections").select("id,kind,odometer_km,fuel_level_eighths,battery_level_pct,status,performed_at").eq("booking_id", id),
    can(ctx, "damages.read") ? db.from("vehicle_damages").select("id,damage_type,location,status,estimated_cost_minor").eq("booking_id", id) : Promise.resolve({ data: [] }),
    db.from("branches").select("id,name").eq("tenant_id", ctx.tenantId),
    can(ctx, "bookings.write") ? db.from("vehicles").select("id,make,model,registration_plate").eq("tenant_id", ctx.tenantId).not("status", "in", "(SOLD,INACTIVE,DAMAGED)") : Promise.resolve({ data: [] }),
  ]);
  const c = cust.data!;
  const branchName = (x: string) => (branches.data ?? []).find((br) => br.id === x)?.name ?? "—";
  const next = BOOKING_TRANSITIONS[b.status as BookingStatus].filter((s) => can(ctx, transitionPermission(s)) && s !== "ACTIVE" && s !== "RETURNED");
  const balance = Number(b.total_minor) - (Number(b.amount_paid_minor) - Number(b.amount_refunded_minor));
  const cur = b.currency as typeof ctx.currency;
  const modifiable = ["PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP"].includes(b.status);
  const docHref = (p: string) => `/t/${ctx.slug}/documents?path=${encodeURIComponent(p)}`;

  return (
    <>
      <PageHeader title={`${t("admin.bookings.reference")} ${b.reference}`} subtitle={`v${b.version} · ${t(`admin.bookingMode.${b.mode}`)}`}
        actions={<>
          <Badge status={b.status}>{t(`booking.status.${b.status}`)}</Badge>
          {["CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP"].includes(b.status) && can(ctx, "inspections.perform") ? <Link className="btn-primary px-4 py-2 text-sm" href={`${path}/pickup`}>{t("admin.pickup.start")}</Link> : null}
          {["ACTIVE", "RETURN_DUE"].includes(b.status) && can(ctx, "inspections.perform") ? <Link className="btn-primary px-4 py-2 text-sm" href={`${path}/return`}>{t("admin.return.start")}</Link> : null}
          {can(ctx, "messages.write") ? <Link className="btn-ghost px-4 py-2 text-sm" href={`/t/${ctx.slug}/messages/new?customer=${c.id}&booking=${b.id}`}>{t("admin.messages.contact")}</Link> : null}
        </>} />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title={t("admin.bookings.summary")}>
            <DL items={[
              [t("admin.bookings.customer"), <Link key="c" href={`/t/${ctx.slug}/customers/${c.id}`} className="text-brand hover:underline">{c.first_name} {c.last_name}</Link>],
              [t("auth.email"), c.email],
              [t("admin.bookings.vehicle"), veh.data ? `${veh.data.make} ${veh.data.model} · ${veh.data.registration_plate}` : t("admin.bookings.unassigned")],
              [t("admin.bookings.pickup"), `${branchName(b.pickup_branch_id)} · ${dt(b.starts_at, ctx.timezone, lang)}`],
              [t("admin.bookings.return"), `${branchName(b.return_branch_id)} · ${dt(b.ends_at, ctx.timezone, lang)}`],
              [t("admin.bookings.pickupType"), t(`admin.pickupType.${b.pickup_type}`) + (b.delivery_address ? ` — ${b.delivery_address}` : "")],
              [t("admin.bookings.driverAge"), b.driver_age ?? "—"],
              [t("admin.bookings.includedKm"), b.included_km ?? t("vehicle.unlimitedMileage")],
            ]} />
            {c.is_restricted ? <p className="mt-4 text-sm text-bad" role="alert">{t("admin.customers.restrictedWarning")}</p> : null}
            {b.customer_notes ? <p className="mt-4 rounded-md bg-raised p-3 text-sm">{b.customer_notes}</p> : null}
          </Card>

          <Card title={t("admin.bookings.pricing")}>
            <Table head={[t("admin.common.item"), t("admin.common.qty"), t("admin.common.amount")]}>
              {(lines.data ?? []).map((l) => (
                <tr key={l.id}><td>{priceLineLabel(lang, l.label, l.label_params as Record<string, string | number>, Number(l.quantity))}{l.is_post_rental ? <Badge>{t("admin.bookings.postRental")}</Badge> : null}</td>
                  <td className="tabular-nums">{Number(l.quantity)}</td><td className="tabular-nums">{money(l.amount_minor, cur, lang)}</td></tr>
              ))}
            </Table>
            <DL items={[
              [t("common.total"), money(b.total_minor, cur, lang)], [t("pricing.deposit"), money(b.deposit_minor, cur, lang)],
              [t("admin.bookings.paid"), money(Number(b.amount_paid_minor) - Number(b.amount_refunded_minor), cur, lang)],
              [t("admin.bookings.balance"), <span key="bal" className={balance > 0 ? "text-warn" : ""}>{money(balance, cur, lang)}</span>],
              ...(b.cancellation_fee_minor !== null ? [[t("admin.bookings.cancellationFee"), money(b.cancellation_fee_minor, cur, lang)] as [string, string]] : []),
            ]} />
          </Card>

          {can(ctx, "payments.read") ? (
            <Card title={t("admin.nav.payments")}>
              {(pays.data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
                <Table head={[t("admin.payments.purpose"), t("admin.common.status"), t("admin.common.amount"), t("admin.payments.refunded"), ""]}>
                  {(pays.data ?? []).map((p) => (
                    <tr key={p.id}>
                      <td>{t(`admin.payments.purposes.${p.purpose}`)}<br /><span className="text-xs text-muted">{p.provider}{p.is_test ? " · test" : ""}</span></td>
                      <td><Badge>{t(`admin.payments.statuses.${p.status}`)}</Badge></td>
                      <td className="tabular-nums">{money(p.amount_captured_minor || p.amount_minor, cur, lang)}</td>
                      <td className="tabular-nums">{money(p.amount_refunded_minor, cur, lang)}</td>
                      <td>{can(ctx, "payments.refund") && p.status === "SUCCEEDED" && !p.provider.startsWith("manual") && Number(p.amount_captured_minor) > Number(p.amount_refunded_minor) ? (
                        <ActionForm action={refundAction} lang={lang} submitLabel={t("admin.payments.refund")} variant="ghost" className="flex flex-wrap items-end gap-2" confirm={t("admin.payments.refundConfirm")}>
                          <TenantFields slug={ctx.slug} path={path} /><Hidden name="paymentId" value={p.id} /><Hidden name="idempotencyKey" value={randomUUID()} />
                          <input name="amount" aria-label={t("admin.common.amount")} defaultValue={toMajor(Number(p.amount_captured_minor) - Number(p.amount_refunded_minor))} className="field w-28 py-1.5" inputMode="decimal" />
                          <input name="reason" aria-label={t("admin.common.reason")} placeholder={t("admin.common.reason")} className="field w-36 py-1.5" required />
                        </ActionForm>) : null}</td>
                    </tr>
                  ))}
                </Table>
              )}
              {(refunds.data ?? []).length ? (
                <p className="mt-3 text-xs text-muted">{(refunds.data ?? []).map((r) => `${t("admin.payments.refund")} ${money(r.amount_minor, cur, lang)} · ${r.status} · ${r.reason}`).join(" | ")}</p>
              ) : null}
              {balance > 0 && can(ctx, "payments.charge") ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <ActionForm action={recordPaymentAction} lang={lang} submitLabel={t("admin.payments.recordCounter")} variant="ghost" className="space-y-2">
                    <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} /><Hidden name="idempotencyKey" value={randomUUID()} />
                    <Field label={t("admin.common.amount")} name="amount" defaultValue={toMajor(balance)} required />
                    <Select label={t("admin.payments.method")} name="method" required options={[{ value: "cash", label: t("admin.payments.cash") }, { value: "terminal", label: t("admin.payments.terminal") }, { value: "bank", label: t("admin.payments.bank") }]} />
                  </ActionForm>
                  <ActionForm action={chargeBalanceAction} lang={lang} submitLabel={t("admin.payments.chargeSaved")} variant="ghost" className="space-y-2" confirm={t("admin.payments.chargeConfirm")}>
                    <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} /><Hidden name="idempotencyKey" value={randomUUID()} />
                    <Field label={t("admin.common.amount")} name="amount" defaultValue={toMajor(balance)} required />
                  </ActionForm>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card title={t("admin.bookings.inspectionsAndDamage")}>
            {(inspections.data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
              <Table head={[t("admin.common.type"), t("admin.inspections.odometer"), t("admin.inspections.fuel"), t("admin.common.status"), t("admin.common.date")]}>
                {(inspections.data ?? []).map((i) => <tr key={i.id}><td>{t(`admin.inspections.kinds.${i.kind}`)}</td><td className="tabular-nums">{i.odometer_km} km</td>
                  <td>{i.fuel_level_eighths !== null ? `${i.fuel_level_eighths}/8` : i.battery_level_pct !== null ? `${i.battery_level_pct}%` : "—"}</td><td>{i.status}</td><td>{dt(i.performed_at, ctx.timezone, lang)}</td></tr>)}
              </Table>
            )}
            {(damages.data ?? []).map((d) => <p key={d.id} className="mt-2 text-sm"><Link className="text-brand hover:underline" href={`/t/${ctx.slug}/damages/${d.id}`}>{t(`admin.damages.types.${d.damage_type}`)} {d.location ? `· ${d.location}` : ""}</Link> <Badge>{t(`admin.damages.statuses.${d.status}`)}</Badge></p>)}
          </Card>

          <Card title={t("admin.bookings.notes")}>
            {can(ctx, "bookings.write") ? (
              <ActionForm action={addNoteAction} lang={lang} submitLabel={t("admin.common.add")} resetOnSuccess>
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} />
                <TextArea label={t("admin.bookings.note")} name="body" rows={2} required maxLength={5000} />
                <Check label={t("admin.bookings.customerVisible")} name="customerVisible" />
              </ActionForm>
            ) : null}
            <ul className="mt-4 space-y-3">
              {(notes.data ?? []).map((n) => <li key={n.id} className="rounded-md bg-raised p-3 text-sm"><p className="whitespace-pre-line">{n.body}</p><p className="mt-1 text-xs text-muted">{dt(n.created_at, ctx.timezone, lang)} · {n.is_internal ? t("admin.bookings.internal") : t("admin.bookings.customerVisible")}</p></li>)}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          {next.length ? (
            <Card title={t("admin.bookings.actions")}>
              <div className="space-y-3">
                {next.map((s) => (
                  <ActionForm key={s} action={transitionAction} lang={lang} submitLabel={t(`admin.transitions.${s}`)} variant={s === "CANCELLED" || s === "NO_SHOW" ? "danger" : "ghost"}
                    confirm={s === "CANCELLED" || s === "NO_SHOW" ? t("admin.bookings.confirmTransition") : undefined} className="space-y-2">
                    <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} /><Hidden name="to" value={s} /><Hidden name="version" value={b.version} />
                    {s === "CANCELLED" || s === "NO_SHOW" || s === "DISPUTED" ? <input name="reason" required placeholder={t("admin.common.reason")} aria-label={t("admin.common.reason")} className="field py-2" /> : null}
                  </ActionForm>
                ))}
              </div>
            </Card>
          ) : null}

          {can(ctx, "bookings.write") && modifiable ? (
            <Card title={t("admin.bookings.assignVehicle")}>
              <ActionForm action={assignVehicleAction} lang={lang} submitLabel={t("admin.common.save")}>
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} />
                <Select label={t("admin.bookings.vehicle")} name="vehicleId" required defaultValue={b.vehicle_id}
                  options={(candidates.data ?? []).map((v) => ({ value: v.id, label: `${v.make} ${v.model} · ${v.registration_plate}` }))} />
                <Select label={t("admin.common.reason")} name="reason" required defaultValue={b.vehicle_id ? "SUBSTITUTION" : "CLASS_ASSIGNMENT"}
                  options={["CLASS_ASSIGNMENT", "SUBSTITUTION", "UPGRADE"].map((r) => ({ value: r, label: t(`admin.assignReason.${r}`) }))} />
              </ActionForm>
            </Card>
          ) : null}

          {can(ctx, "bookings.write") && modifiable ? (
            <Card title={t("admin.bookings.modify")}>
              <ActionForm action={modifyDatesAction} lang={lang} submitLabel={t("admin.bookings.reprice")}>
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} /><Hidden name="version" value={b.version} />
                <Field label={t("search.pickupDate")} name="start" type="datetime-local" required defaultValue={utcToZonedLocal(new Date(b.starts_at), ctx.timezone)} />
                <Field label={t("search.returnDate")} name="end" type="datetime-local" required defaultValue={utcToZonedLocal(new Date(b.ends_at), ctx.timezone)} />
                <Select label={t("search.returnLocation")} name="returnBranchId" defaultValue={b.return_branch_id} options={(branches.data ?? []).map((br) => ({ value: br.id, label: br.name }))} />
              </ActionForm>
            </Card>
          ) : null}

          {deposit.data ? (
            <Card title={t("pricing.deposit")}>
              <DL items={[[t("admin.common.status"), t(`admin.deposit.${deposit.data.status}`)], [t("admin.common.amount"), money(deposit.data.amount_minor, cur, lang)],
                [t("admin.deposit.captured"), money(deposit.data.captured_minor, cur, lang)], [t("admin.deposit.authorizeAfter"), dt(deposit.data.authorize_after, ctx.timezone, lang)]]} />
              {can(ctx, "deposits.manage") ? (
                <div className="mt-4 space-y-3">
                  {["PENDING", "METHOD_SAVED", "FAILED"].includes(deposit.data.status) ? (
                    <ActionForm action={depositAction} lang={lang} submitLabel={t("admin.deposit.authorize")} variant="ghost"><TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} /><Hidden name="op" value="authorize" /></ActionForm>
                  ) : null}
                  {deposit.data.status === "AUTHORIZED" ? (
                    <>
                      <ActionForm action={depositAction} lang={lang} submitLabel={t("admin.deposit.capture")} variant="danger" confirm={t("admin.deposit.captureConfirm")} className="space-y-2">
                        <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} /><Hidden name="op" value="capture" />
                        <Field label={t("admin.deposit.approvedAmount")} name="amount" required hint={t("admin.deposit.captureHint")} />
                        <Field label={t("admin.common.reason")} name="reason" required />
                      </ActionForm>
                      <ActionForm action={depositAction} lang={lang} submitLabel={t("admin.deposit.release")} variant="ghost"><TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} /><Hidden name="op" value="release" /></ActionForm>
                    </>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card title={t("admin.bookings.documents")}>
            <ul className="space-y-2 text-sm">
              <li>{t("admin.bookings.agreement")}: {agreement.data ? <><Badge>{t(`admin.agreement.${agreement.data.status}`)}</Badge>{agreement.data.pdf_path ? <a className="ml-2 text-brand hover:underline" href={docHref(agreement.data.pdf_path)}>PDF</a> : null}</> : "—"}</li>
              {(invoices.data ?? []).map((i) => <li key={i.id}>{t(`admin.invoiceKind.${i.kind}`)} {i.number} · {money(i.total_minor, cur, lang)}{i.pdf_path ? <a className="ml-2 text-brand hover:underline" href={docHref(i.pdf_path)}>PDF</a> : null}</li>)}
            </ul>
            {can(ctx, "payments.read") ? (
              <ActionForm action={invoiceAction} lang={lang} submitLabel={t("admin.bookings.issueInvoice")} variant="ghost" className="mt-3 flex gap-2">
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="bookingId" value={b.id} /><Hidden name="kind" value="INVOICE" />
              </ActionForm>
            ) : null}
          </Card>

          <Card title={t("admin.bookings.history")}>
            <ol className="space-y-2 text-sm">
              {(history.data ?? []).map((h) => <li key={h.id}><Badge status={h.to_status}>{t(`booking.status.${h.to_status}`)}</Badge> <span className="text-xs text-muted">{dt(h.created_at, ctx.timezone, lang)}{h.reason ? ` · ${h.reason}` : ""}</span></li>)}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
