import "server-only";
import type { SupabaseClient } from "@rental/auth";
import { toPayloadLines, type CreateBookingPayload, type CreateBookingResult } from "@rental/database";
import { planDeposit, platformFee, type PaymentProvider } from "@rental/payments";
import { BusinessError, type CurrencyCode } from "@rental/types";
import type { CreateBookingRequest } from "@rental/validation";
import { buildQuote } from "./pricing-context";

type Row = Record<string, unknown>;

/** Find or create the caller's customer record in this tenant (service role; user already authenticated). */
async function ensureCustomer(db: SupabaseClient, tenantId: string, user: { id: string; email: string | null }): Promise<Row> {
  const { data: existing, error } = await db.from("customers").select("*").eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing;
  const { data: profile } = await db.from("profiles").select("first_name,last_name,phone").eq("id", user.id).maybeSingle();
  if (!profile?.first_name || !profile?.last_name || !user.email) throw new BusinessError("PROFILE_INCOMPLETE", 422);
  const { data, error: insertError } = await db.from("customers").insert({
    tenant_id: tenantId, user_id: user.id, first_name: profile.first_name, last_name: profile.last_name, email: user.email, phone: profile.phone,
  }).select("*").single();
  if (insertError) throw new Error(insertError.message);
  return data;
}

async function commissionTerms(db: SupabaseClient, tenantId: string) {
  const { data } = await db.from("tenant_subscriptions")
    .select("commission_kind,commission_bps,commission_fixed_minor, plan:subscription_plans(commission_kind,commission_bps,commission_fixed_minor)")
    .eq("tenant_id", tenantId).in("status", ["TRIALING", "ACTIVE", "PAST_DUE", "LIFETIME"]).maybeSingle();
  const plan = (data?.plan ?? null) as Row | null;
  return {
    kind: (data?.commission_kind ?? plan?.commission_kind ?? "NONE") as "NONE" | "PERCENTAGE" | "FIXED" | "CUSTOM",
    bps: Number(data?.commission_bps ?? plan?.commission_bps ?? 0),
    fixedMinor: Number(data?.commission_fixed_minor ?? plan?.commission_fixed_minor ?? 0),
  };
}

export interface CreateBookingOutcome {
  booking: CreateBookingResult;
  payment: { clientSecret: string | null; amountMinor: number; stripeAccount: string | null } | null;
}

/**
 * Customer booking flow: re-price on the server, create the booking hold
 * atomically in Postgres (exclusion constraint = no double booking), then
 * open a PaymentIntent for the amount due now. Payment success is only ever
 * recorded from a verified provider webhook — never from the client.
 */
export async function createCustomerBooking(
  db: SupabaseClient,
  provider: PaymentProvider | null,
  tenantId: string,
  user: { id: string; email: string | null },
  req: CreateBookingRequest,
): Promise<CreateBookingOutcome> {
  const customer = await ensureCustomer(db, tenantId, user);
  if (customer.is_restricted) throw new BusinessError("CUSTOMER_RESTRICTED");

  const ctx = await buildQuote(db, tenantId, req, { driverDob: (customer.date_of_birth as string | null) ?? req.driverDateOfBirth ?? null });
  const q = ctx.quote;
  const minAge = Number(ctx.vehicle?.minimum_driver_age ?? ctx.settings.default_min_driver_age);
  if (ctx.input.driverAge !== null && ctx.input.driverAge < minAge) throw new BusinessError("VALIDATION_FAILED", 422, { driverAge: "BELOW_MINIMUM" });

  const needsPayment = q.dueNowMinor > 0;
  let account: Row | null = null;
  if (needsPayment) {
    const { data } = await db.from("tenant_payment_accounts").select("*").eq("tenant_id", tenantId).maybeSingle();
    account = data;
    // Refuse up front rather than holding a car we cannot take payment for.
    if (!provider || !account || (provider.mode === "live" && !account.charges_enabled)) throw new BusinessError("PAYMENTS_NOT_CONFIGURED", 503);
  }

  const payload: CreateBookingPayload = {
    tenant_id: tenantId,
    actor_user_id: user.id,
    customer_id: customer.id as string,
    vehicle_id: req.vehicleId ?? null,
    vehicle_class_id: req.vehicleId ? null : ctx.classId,
    pickup_branch_id: req.pickupBranchId,
    return_branch_id: req.returnBranchId,
    pickup_type: req.pickupType,
    delivery_address: req.deliveryAddress ?? null,
    starts_at: req.startsAt,
    ends_at: req.endsAt,
    initial_status: needsPayment ? "PENDING_PAYMENT" : "CONFIRMED",
    currency: q.currency,
    rental_minor: q.rentalMinor,
    extras_minor: q.extrasMinor,
    fees_minor: q.feesMinor,
    discount_minor: q.discountMinor,
    tax_minor: q.taxMinor,
    total_minor: q.totalMinor,
    deposit_minor: q.depositMinor,
    due_now_minor: q.dueNowMinor,
    lines: toPayloadLines(q.lines),
    extras: q.lines
      .filter((l) => (l.kind === "EXTRA" || l.kind === "INSURANCE") && l.sourceRuleId)
      .map((l) => ({ extra_id: l.sourceRuleId!, quantity: l.quantity, unit_price_minor: l.unitAmountMinor, total_minor: l.amountMinor })),
    pricing_snapshot: { engineVersion: q.engineVersion, days: q.days, includedTaxMinor: q.includedTaxMinor, dueLaterMinor: q.dueLaterMinor, quotedAt: ctx.input.now.toISOString() },
    discount_code_id: ctx.discountCodeId,
    included_km: q.includedKm,
    driver_age: ctx.input.driverAge,
    additional_drivers: req.additionalDrivers,
    customer_notes: req.customerNotes ?? null,
    idempotency_key: req.idempotencyKey,
  };

  const { data, error } = await db.rpc("create_booking", { p: payload });
  if (error) throw error;
  const booking = data as CreateBookingResult;

  await db.from("consent_records").insert({
    tenant_id: tenantId, user_id: user.id, customer_id: customer.id, consent_type: "TERMS",
    policy_version: req.acceptedTermsVersion, granted: true, context: { bookingId: booking.id },
  });

  // Deposit plan (authorisation happens close to pickup; see PAYMENTS.md).
  if (q.depositMinor > 0 && !booking.replayed) {
    const plan = planDeposit(q.depositMinor, new Date(req.startsAt), new Date(req.endsAt), new Date(), Number(ctx.settings.deposit_authorize_hours_before));
    await db.from("security_deposits").upsert({
      tenant_id: tenantId, booking_id: booking.id, amount_minor: q.depositMinor, currency: q.currency,
      status: plan.strategy === "NOT_REQUIRED" ? "NOT_REQUIRED" : "PENDING", authorize_after: plan.authorizeAfter?.toISOString() ?? null,
    }, { onConflict: "booking_id", ignoreDuplicates: true });
  }

  if (!needsPayment || !provider) return { booking, payment: null };

  const connectedAccountId = (account?.provider_account_id as string | null) ?? undefined;
  const fee = connectedAccountId ? platformFee(q.dueNowMinor, await commissionTerms(db, tenantId)) : 0;
  const idempotencyKey = `${req.idempotencyKey}:rental`;
  const intent = await provider.createPaymentIntent({
    amountMinor: q.dueNowMinor,
    currency: q.currency as CurrencyCode,
    captureMethod: "automatic",
    saveForFutureUse: q.depositMinor > 0,
    ...(fee > 0 ? { applicationFeeMinor: fee } : {}),
    ...(connectedAccountId ? { connectedAccountId } : {}),
    idempotencyKey,
    description: `Booking ${booking.reference}`,
    metadata: { tenantId, bookingId: booking.id, reference: booking.reference, purpose: "RENTAL" },
  });
  const { error: payError } = await db.from("payments").upsert({
    tenant_id: tenantId, booking_id: booking.id, customer_id: customer.id, purpose: "RENTAL", provider: provider.name,
    provider_payment_id: intent.providerPaymentId, amount_minor: q.dueNowMinor, application_fee_minor: fee, currency: q.currency,
    status: "REQUIRES_PAYMENT", idempotency_key: idempotencyKey, is_test: provider.mode === "test",
  }, { onConflict: "tenant_id,idempotency_key", ignoreDuplicates: true });
  if (payError) throw new Error(payError.message);

  return { booking, payment: { clientSecret: intent.clientSecret, amountMinor: q.dueNowMinor, stripeAccount: connectedAccountId ?? null } };
}
