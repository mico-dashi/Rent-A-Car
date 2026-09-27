"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createStaffBooking, modifyBookingDates, refundPayment, authorizeDeposit, captureDeposit, releaseDeposit, issueInvoice, chargeBalance } from "@rental/server";
import { zonedLocalToUtc } from "@rental/domain";
import { BOOKING_STATUSES, type BookingStatus } from "@rental/types";
import { z } from "@rental/validation";
import { check, money, num, str, tenantAction, type ActionResult } from "@/lib/actions";
import { provider } from "@/lib/providers";
import { serviceClient, userClient } from "@/lib/supabase/server";


export async function createBookingAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const res = await tenantAction(fd, "bookings.write", async (ctx) => {
    const tz = ctx.timezone;
    const input = z.object({
      customerId: z.string().uuid(), vehicleId: z.string().uuid(), pickupBranchId: z.string().uuid(), returnBranchId: z.string().uuid(),
      start: z.string().min(16), end: z.string().min(16), status: z.enum(["CONFIRMED", "PENDING_PAYMENT"]),
      extras: z.array(z.string().uuid()), discountCode: z.string().max(40).optional(), notes: z.string().max(1000).optional(),
    }).parse({
      customerId: str(fd, "customerId"), vehicleId: str(fd, "vehicleId"), pickupBranchId: str(fd, "pickupBranchId"),
      returnBranchId: str(fd, "returnBranchId") ?? str(fd, "pickupBranchId"), start: str(fd, "start"), end: str(fd, "end"),
      status: str(fd, "status") ?? "CONFIRMED", extras: fd.getAll("extras").map(String), discountCode: str(fd, "discountCode") ?? undefined,
      notes: str(fd, "notes") ?? undefined,
    });
    const b = await createStaffBooking(serviceClient(), ctx.tenantId, ctx.userId, {
      tenantId: ctx.tenantId, customerId: input.customerId, vehicleId: input.vehicleId, pickupBranchId: input.pickupBranchId, returnBranchId: input.returnBranchId,
      startsAt: zonedLocalToUtc(input.start.slice(0, 16), tz).toISOString(), endsAt: zonedLocalToUtc(input.end.slice(0, 16), tz).toISOString(),
      pickupType: "BRANCH", additionalDrivers: 0, extras: input.extras.map((extraId) => ({ extraId, quantity: 1 })),
      ...(input.discountCode ? { discountCode: input.discountCode } : {}), initialStatus: input.status,
      idempotencyKey: String(fd.get("idempotencyKey") || randomUUID()), notes: input.notes,
    });
    id = b.id;
  });
  if (res?.ok && id) redirect(`/t/${fd.get("_tenant")}/bookings/${id}`);
  return res;
}

export async function transitionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "bookings.read", async () => {
    const to = String(fd.get("to"));
    if (!(BOOKING_STATUSES as readonly string[]).includes(to)) throw new Error("VALIDATION_FAILED");
    const db = await userClient();
    check(await db.rpc("transition_booking", { p_booking: str(fd, "bookingId"), p_to: to as BookingStatus, p_reason: str(fd, "reason"), p_expected_version: num(fd, "version") }));
  });
}

export async function assignVehicleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "bookings.write", async () => {
    const db = await userClient();
    check(await db.rpc("assign_booking_vehicle", { p_booking: str(fd, "bookingId"), p_vehicle: str(fd, "vehicleId"), p_reason: str(fd, "reason") ?? "SUBSTITUTION" }));
  });
}

export async function addNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "bookings.write", async (ctx) => {
    const body = z.string().min(1).max(5000).parse(str(fd, "body"));
    const db = await userClient();
    check(await db.from("booking_notes").insert({ tenant_id: ctx.tenantId, booking_id: str(fd, "bookingId")!, body, is_internal: fd.get("customerVisible") !== "on", author_id: ctx.userId }));
    return { ok: true };
  });
}

export async function modifyDatesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "bookings.write", async (ctx) => {
    const start = str(fd, "start"), end = str(fd, "end");
    if (!start || !end) throw new Error("VALIDATION_FAILED");
    const r = await modifyBookingDates(serviceClient(), ctx.userId, {
      bookingId: str(fd, "bookingId")!, startsAt: zonedLocalToUtc(start.slice(0, 16), ctx.timezone).toISOString(),
      endsAt: zonedLocalToUtc(end.slice(0, 16), ctx.timezone).toISOString(), ...(str(fd, "returnBranchId") ? { returnBranchId: str(fd, "returnBranchId")! } : {}),
      ...(num(fd, "version") ? { expectedVersion: num(fd, "version")! } : {}),
    });
    return { ok: true, data: { balance: r.balance_minor } };
  });
}

export async function refundAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "payments.refund", async (ctx) => {
    const p = provider();
    if (!p) throw new Error("PAYMENTS_NOT_CONFIGURED");
    const amount = money(fd, "amount");
    if (!amount) throw new Error("VALIDATION_FAILED");
    const db = serviceClient();
    const { data: pay } = await db.from("payments").select("tenant_id").eq("id", str(fd, "paymentId")!).single();
    if (pay?.tenant_id !== ctx.tenantId) throw new Error("FORBIDDEN");
    await refundPayment(db, p, { paymentId: str(fd, "paymentId")!, amountMinor: amount, reason: str(fd, "reason") ?? "STAFF", actorId: ctx.userId, idempotencyKey: String(fd.get("idempotencyKey") || randomUUID()) });
  });
}

async function ownedBooking(tenantId: string, bookingId: string | null) {
  const { data } = await serviceClient().from("bookings").select("id,tenant_id").eq("id", bookingId ?? "").maybeSingle();
  if (!data || data.tenant_id !== tenantId) throw new Error("FORBIDDEN");
  return data.id;
}

export async function depositAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "deposits.manage", async (ctx) => {
    const p = provider();
    if (!p) throw new Error("PAYMENTS_NOT_CONFIGURED");
    const id = await ownedBooking(ctx.tenantId, str(fd, "bookingId"));
    const op = str(fd, "op");
    const db = serviceClient();
    if (op === "authorize") await authorizeDeposit(db, p, id);
    else if (op === "release") await releaseDeposit(db, p, id);
    else if (op === "capture") {
      const amount = money(fd, "amount");
      if (!amount) throw new Error("VALIDATION_FAILED");
      await captureDeposit(db, p, { bookingId: id, approvedChargesMinor: [amount], reason: str(fd, "reason") ?? "APPROVED_CHARGES", actorId: ctx.userId });
    } else throw new Error("VALIDATION_FAILED");
  });
}

export async function chargeBalanceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "payments.charge", async (ctx) => {
    const p = provider();
    if (!p) throw new Error("PAYMENTS_NOT_CONFIGURED");
    const id = await ownedBooking(ctx.tenantId, str(fd, "bookingId"));
    const amount = money(fd, "amount");
    if (!amount) throw new Error("VALIDATION_FAILED");
    await chargeBalance(serviceClient(), p, { bookingId: id, amountMinor: amount, purpose: "RENTAL", approvedBy: ctx.userId, idempotencyKey: String(fd.get("idempotencyKey") || randomUUID()) });
  });
}

export async function invoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "payments.read", async (ctx) => {
    const id = await ownedBooking(ctx.tenantId, str(fd, "bookingId"));
    const inv = await issueInvoice(serviceClient(), id, fd.get("kind") === "RECEIPT" ? "RECEIPT" : "INVOICE");
    return { ok: true, message: String(inv.number) };
  });
}

export async function recordPaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  // Payment taken at the counter (cash / external terminal): recorded by staff with payments.charge.
  return tenantAction(fd, "payments.charge", async (ctx) => {
    const id = await ownedBooking(ctx.tenantId, str(fd, "bookingId"));
    const amount = money(fd, "amount");
    if (!amount) throw new Error("VALIDATION_FAILED");
    const db = serviceClient();
    const { data: b } = await db.from("bookings").select("currency,customer_id").eq("id", id).single();
    const pay = check(await db.from("payments").insert({
      tenant_id: ctx.tenantId, booking_id: id, customer_id: b!.customer_id, purpose: "RENTAL", provider: `manual:${str(fd, "method") ?? "cash"}`,
      amount_minor: amount, amount_captured_minor: amount, currency: b!.currency, status: "SUCCEEDED", idempotency_key: String(fd.get("idempotencyKey") || randomUUID()),
      is_test: false, approved_by: ctx.userId,
    }).select("id").single());
    check(await db.rpc("record_booking_payment", { p_booking: id, p_amount_minor: amount, p_payment_id: pay!.id }));
  });
}
