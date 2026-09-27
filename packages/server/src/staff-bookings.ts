import type { SupabaseClient } from "@rental/auth";
import { toPayloadLines, type CreateBookingPayload, type CreateBookingResult } from "@rental/database";
import { planDeposit } from "@rental/payments";
import { BusinessError, type PriceLine } from "@rental/types";
import type { QuoteRequest } from "@rental/validation";
import { buildQuote } from "./pricing-context";

type Row = Record<string, unknown>;

export interface StaffBookingInput extends Omit<QuoteRequest, "driverDateOfBirth"> {
  customerId: string;
  initialStatus: "CONFIRMED" | "PENDING_PAYMENT" | "PENDING_APPROVAL";
  idempotencyKey: string;
  notes?: string | undefined;
}

function payloadFromQuote(base: Omit<CreateBookingPayload, "currency" | "rental_minor" | "extras_minor" | "fees_minor" | "discount_minor" | "tax_minor" | "total_minor" | "deposit_minor" | "due_now_minor" | "lines" | "pricing_snapshot">,
  q: Awaited<ReturnType<typeof buildQuote>>["quote"], now: Date): CreateBookingPayload {
  return {
    ...base,
    currency: q.currency, rental_minor: q.rentalMinor, extras_minor: q.extrasMinor, fees_minor: q.feesMinor, discount_minor: q.discountMinor,
    tax_minor: q.taxMinor, total_minor: q.totalMinor, deposit_minor: q.depositMinor, due_now_minor: q.dueNowMinor,
    lines: toPayloadLines(q.lines),
    extras: q.lines.filter((l: PriceLine) => (l.kind === "EXTRA" || l.kind === "INSURANCE") && l.sourceRuleId)
      .map((l: PriceLine) => ({ extra_id: l.sourceRuleId!, quantity: l.quantity, unit_price_minor: l.unitAmountMinor, total_minor: l.amountMinor })),
    pricing_snapshot: { engineVersion: q.engineVersion, days: q.days, includedTaxMinor: q.includedTaxMinor, dueLaterMinor: q.dueLaterMinor, quotedAt: now.toISOString() },
  };
}

/**
 * Staff creates a booking for an existing customer (phone/walk-in). Pricing is
 * the same engine; lead-time rules are relaxed for staff inside create_booking.
 * Caller must have verified `bookings.write` for the tenant.
 */
export async function createStaffBooking(db: SupabaseClient, tenantId: string, actorId: string, input: StaffBookingInput): Promise<CreateBookingResult> {
  const { data: customer } = await db.from("customers").select("id,date_of_birth,is_restricted").eq("tenant_id", tenantId).eq("id", input.customerId).maybeSingle();
  if (!customer) throw new BusinessError("CUSTOMER_NOT_FOUND", 404);
  const now = new Date();
  const ctx = await buildQuote(db, tenantId, input, { now, driverDob: (customer.date_of_birth as string | null) ?? null });
  const payload = payloadFromQuote({
    tenant_id: tenantId, actor_user_id: actorId, customer_id: input.customerId,
    vehicle_id: input.vehicleId ?? null, vehicle_class_id: input.vehicleId ? null : ctx.classId,
    pickup_branch_id: input.pickupBranchId, return_branch_id: input.returnBranchId, pickup_type: input.pickupType,
    delivery_address: input.deliveryAddress ?? null, starts_at: input.startsAt, ends_at: input.endsAt, initial_status: input.initialStatus,
    discount_code_id: ctx.discountCodeId, included_km: ctx.quote.includedKm, driver_age: ctx.input.driverAge,
    additional_drivers: input.additionalDrivers, customer_notes: input.notes ?? null, idempotency_key: input.idempotencyKey,
  }, ctx.quote, now);
  const { data, error } = await db.rpc("create_booking", { p: payload });
  if (error) throw error;
  const booking = data as CreateBookingResult;
  if (ctx.quote.depositMinor > 0 && !booking.replayed) {
    const plan = planDeposit(ctx.quote.depositMinor, new Date(input.startsAt), new Date(input.endsAt), now, Number(ctx.settings.deposit_authorize_hours_before));
    await db.from("security_deposits").upsert({
      tenant_id: tenantId, booking_id: booking.id, amount_minor: ctx.quote.depositMinor, currency: ctx.quote.currency,
      status: "PENDING", authorize_after: plan.authorizeAfter?.toISOString() ?? null,
    }, { onConflict: "booking_id", ignoreDuplicates: true });
  }
  return booking;
}

/**
 * Change dates / return branch of a booking. Re-prices with the same extras
 * and discount, then atomically moves the occupancy block (modify_booking).
 * Returns the new balance: positive = customer owes more, negative = refund due.
 */
export async function modifyBookingDates(db: SupabaseClient, actorId: string, input: {
  bookingId: string; startsAt: string; endsAt: string; returnBranchId?: string; expectedVersion?: number;
}) {
  const { data: b } = await db.from("bookings").select("*").eq("id", input.bookingId).maybeSingle();
  if (!b) throw new BusinessError("BOOKING_NOT_FOUND", 404);
  const [{ data: extras }, { data: customer }, { data: code }] = await Promise.all([
    db.from("booking_extras").select("extra_id,quantity").eq("booking_id", b.id),
    db.from("customers").select("date_of_birth").eq("id", b.customer_id).single(),
    b.discount_code_id ? db.from("discount_codes").select("code").eq("id", b.discount_code_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const req: QuoteRequest = {
    tenantId: b.tenant_id as string,
    ...(b.vehicle_id ? { vehicleId: b.vehicle_id as string } : { vehicleClassId: b.vehicle_class_id as string }),
    pickupBranchId: b.pickup_branch_id as string, returnBranchId: input.returnBranchId ?? (b.return_branch_id as string),
    startsAt: input.startsAt, endsAt: input.endsAt, pickupType: b.pickup_type as QuoteRequest["pickupType"],
    ...(b.delivery_address ? { deliveryAddress: b.delivery_address as string } : {}),
    additionalDrivers: Number(b.additional_drivers),
    extras: ((extras ?? []) as Row[]).map((e) => ({ extraId: e.extra_id as string, quantity: Number(e.quantity) })),
    ...(code?.code ? { discountCode: code.code as string } : {}),
  };
  const now = new Date();
  const ctx = await buildQuote(db, b.tenant_id as string, req, { now, driverDob: (customer?.date_of_birth as string | null) ?? null });
  const q = ctx.quote;
  const { data, error } = await db.rpc("modify_booking", { p: {
    booking_id: b.id, actor_user_id: actorId, starts_at: input.startsAt, ends_at: input.endsAt, return_branch_id: input.returnBranchId ?? null,
    expected_version: input.expectedVersion ?? null, rental_minor: q.rentalMinor, extras_minor: q.extrasMinor, fees_minor: q.feesMinor,
    discount_minor: q.discountMinor, tax_minor: q.taxMinor, total_minor: q.totalMinor, deposit_minor: q.depositMinor, due_now_minor: q.dueNowMinor,
    lines: toPayloadLines(q.lines),
    pricing_snapshot: { engineVersion: q.engineVersion, days: q.days, includedTaxMinor: q.includedTaxMinor, quotedAt: now.toISOString() },
  } });
  if (error) throw error;
  return data as { id: string; version: number; total_minor: number; balance_minor: number };
}
