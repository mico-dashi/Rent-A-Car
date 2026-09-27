import type { SupabaseClient } from "@rental/auth";
import { depositCaptureAmount, platformFee, type PaymentProvider } from "@rental/payments";
import { BusinessError, type CurrencyCode } from "@rental/types";

type Row = Record<string, unknown>;

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new BusinessError("NOT_FOUND", 404);
  return res.data;
}

async function connectedAccount(db: SupabaseClient, tenantId: string): Promise<string | undefined> {
  const { data } = await db.from("tenant_payment_accounts").select("provider_account_id").eq("tenant_id", tenantId).maybeSingle();
  return (data?.provider_account_id as string | null) ?? undefined;
}

/** Provider customer for a tenant customer (created once, stored on the customer row). */
export async function ensureProviderCustomer(db: SupabaseClient, provider: PaymentProvider, customerId: string): Promise<string> {
  const c = must(await db.from("customers").select("id,tenant_id,email,first_name,last_name,payment_provider_customer_id").eq("id", customerId).single()) as Row;
  if (c.payment_provider_customer_id) return c.payment_provider_customer_id as string;
  const acct = await connectedAccount(db, c.tenant_id as string);
  const { providerCustomerId } = await provider.createCustomer({
    email: c.email as string, name: `${c.first_name} ${c.last_name}`, idempotencyKey: `customer:${c.id}`,
    ...(acct ? { connectedAccountId: acct } : {}), metadata: { tenantId: c.tenant_id as string, customerId: c.id as string },
  });
  await db.from("customers").update({ payment_provider_customer_id: providerCustomerId }).eq("id", customerId);
  return providerCustomerId;
}

export async function commissionTermsFor(db: SupabaseClient, tenantId: string) {
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

/**
 * Refund (full or partial) of a captured payment. The DB trigger rejects
 * over-refunds; the provider call reuses the refund's idempotency key; the
 * refund is settled into booking totals exactly once by `record_refund`.
 */
export async function refundPayment(db: SupabaseClient, provider: PaymentProvider, input: {
  paymentId: string; amountMinor: number; reason: string; actorId: string | null; idempotencyKey: string;
}) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new BusinessError("VALIDATION_FAILED", 422);
  const p = must(await db.from("payments").select("*").eq("id", input.paymentId).single()) as Row;
  if (p.status !== "SUCCEEDED" || !p.provider_payment_id) throw new BusinessError("VALIDATION_FAILED", 422);
  const { data: existing } = await db.from("refunds").select("*").eq("tenant_id", p.tenant_id).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  const refund = existing ?? must(await db.from("refunds").insert({
    tenant_id: p.tenant_id, payment_id: p.id, booking_id: p.booking_id, amount_minor: input.amountMinor, currency: p.currency,
    reason: input.reason, idempotency_key: input.idempotencyKey, requested_by: input.actorId,
  }).select("*").single());
  if ((refund as Row).status === "SUCCEEDED") return refund;
  const acct = await connectedAccount(db, p.tenant_id as string);
  const res = await provider.refund({
    providerPaymentId: p.provider_payment_id as string, amountMinor: Number((refund as Row).amount_minor), idempotencyKey: `refund:${(refund as Row).id}`,
    ...(acct ? { connectedAccountId: acct } : {}), metadata: { tenantId: p.tenant_id as string, refundId: (refund as Row).id as string },
  });
  const status = res.status === "succeeded" ? "SUCCEEDED" : res.status === "failed" || res.status === "canceled" ? "FAILED" : "PENDING";
  const { error } = await db.rpc("record_refund", { p_refund: (refund as Row).id, p_status: status, p_provider_refund_id: res.providerRefundId });
  if (error) throw new Error(error.message);
  return { ...(refund as Row), status, provider_refund_id: res.providerRefundId };
}

/** Authorize the security deposit off-session with the saved payment method (manual capture). */
export async function authorizeDeposit(db: SupabaseClient, provider: PaymentProvider, bookingId: string) {
  const dep = must(await db.from("security_deposits").select("*").eq("booking_id", bookingId).single()) as Row;
  if (!["PENDING", "METHOD_SAVED", "FAILED"].includes(dep.status as string)) return dep;
  const b = must(await db.from("bookings").select("id,tenant_id,customer_id,reference,status").eq("id", bookingId).single()) as Row;
  const { data: pm } = await db.from("payment_methods").select("*").eq("customer_id", b.customer_id).order("is_default", { ascending: false })
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!pm) {
    await db.from("security_deposits").update({ status: "PENDING" }).eq("id", dep.id);
    return { ...dep, status: "PENDING", needsPaymentMethod: true };
  }
  const acct = await connectedAccount(db, b.tenant_id as string);
  const key = `deposit:${dep.id}:${Number(dep.captured_minor) === 0 ? "auth" : "reauth"}:${new Date().toISOString().slice(0, 10)}`;
  try {
    const pi = await provider.createPaymentIntent({
      amountMinor: Number(dep.amount_minor), currency: dep.currency as CurrencyCode, captureMethod: "manual", providerCustomerId: pm.provider_customer_id as string,
      paymentMethodId: pm.provider_payment_method_id as string, offSession: true, idempotencyKey: key, description: `Deposit ${b.reference}`,
      ...(acct ? { connectedAccountId: acct } : {}),
      metadata: { tenantId: b.tenant_id as string, bookingId: b.id as string, purpose: "DEPOSIT" },
    });
    const pay = must(await db.from("payments").upsert({
      tenant_id: b.tenant_id, booking_id: b.id, customer_id: b.customer_id, purpose: "DEPOSIT", provider: provider.name, provider_payment_id: pi.providerPaymentId,
      amount_minor: dep.amount_minor, currency: dep.currency, status: pi.status === "requires_capture" ? "AUTHORIZED" : "PROCESSING",
      idempotency_key: key, is_test: provider.mode === "test",
    }, { onConflict: "tenant_id,idempotency_key" }).select("id").single()) as Row;
    const authorized = pi.status === "requires_capture";
    await db.from("security_deposits").update({
      status: authorized ? "AUTHORIZED" : "PENDING", payment_id: pay.id, payment_method_id: pm.id,
      authorized_at: authorized ? new Date().toISOString() : null,
      authorization_expires_at: authorized ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null,
    }).eq("id", dep.id);
    return { ...dep, status: authorized ? "AUTHORIZED" : "PENDING" };
  } catch (e) {
    await db.from("security_deposits").update({ status: "FAILED" }).eq("id", dep.id);
    throw e;
  }
}

/** Capture approved charges from the deposit (≤ authorized); the remainder is released by the provider. */
export async function captureDeposit(db: SupabaseClient, provider: PaymentProvider, input: { bookingId: string; approvedChargesMinor: number[]; reason: string; actorId: string }) {
  const dep = must(await db.from("security_deposits").select("*").eq("booking_id", input.bookingId).single()) as Row;
  if (dep.status !== "AUTHORIZED" || !dep.payment_id) throw new BusinessError("DEPOSIT_NOT_SECURED");
  const pay = must(await db.from("payments").select("*").eq("id", dep.payment_id).single()) as Row;
  const amount = depositCaptureAmount(Number(dep.amount_minor), input.approvedChargesMinor);
  const acct = await connectedAccount(db, dep.tenant_id as string);
  if (amount === 0) return releaseDeposit(db, provider, input.bookingId);
  await provider.capture({ providerPaymentId: pay.provider_payment_id as string, amountMinor: amount, idempotencyKey: `capture:${dep.id}`, ...(acct ? { connectedAccountId: acct } : {}) });
  await db.from("payments").update({ status: "SUCCEEDED", amount_captured_minor: amount, approved_by: input.actorId }).eq("id", pay.id);
  await db.rpc("record_booking_payment", { p_booking: input.bookingId, p_amount_minor: amount, p_payment_id: pay.id });
  await db.from("security_deposits").update({
    status: amount >= Number(dep.amount_minor) ? "CAPTURED" : "PARTIALLY_CAPTURED", captured_minor: amount, capture_reason: input.reason, captured_by: input.actorId,
    released_at: new Date().toISOString(),
  }).eq("id", dep.id);
  return { capturedMinor: amount };
}

export async function releaseDeposit(db: SupabaseClient, provider: PaymentProvider, bookingId: string) {
  const dep = must(await db.from("security_deposits").select("*").eq("booking_id", bookingId).single()) as Row;
  if (dep.status === "AUTHORIZED" && dep.payment_id) {
    const pay = must(await db.from("payments").select("provider_payment_id,tenant_id").eq("id", dep.payment_id).single()) as Row;
    const acct = await connectedAccount(db, pay.tenant_id as string);
    await provider.cancel({ providerPaymentId: pay.provider_payment_id as string, idempotencyKey: `release:${dep.id}`, ...(acct ? { connectedAccountId: acct } : {}) });
    await db.from("payments").update({ status: "CANCELLED" }).eq("id", dep.payment_id);
  }
  await db.from("security_deposits").update({ status: "RELEASED", released_at: new Date().toISOString() }).eq("id", dep.id);
  return { capturedMinor: 0 };
}

/**
 * Charge an outstanding balance (e.g. confirmed post-rental charges, pay-at-pickup
 * remainder) to the saved method. `approvedBy` is mandatory for damage / late fees.
 */
export async function chargeBalance(db: SupabaseClient, provider: PaymentProvider, input: {
  bookingId: string; amountMinor: number; purpose: "RENTAL" | "LATE_FEE" | "DAMAGE" | "OTHER"; approvedBy: string; idempotencyKey: string;
}) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new BusinessError("VALIDATION_FAILED", 422);
  const b = must(await db.from("bookings").select("*").eq("id", input.bookingId).single()) as Row;
  const balance = Number(b.total_minor) - (Number(b.amount_paid_minor) - Number(b.amount_refunded_minor));
  if (input.purpose === "RENTAL" && input.amountMinor > balance) throw new BusinessError("VALIDATION_FAILED", 422);
  const { data: pm } = await db.from("payment_methods").select("*").eq("customer_id", b.customer_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!pm) throw new BusinessError("PAYMENT_REQUIRED");
  const acct = await connectedAccount(db, b.tenant_id as string);
  const fee = acct ? platformFee(input.amountMinor, await commissionTermsFor(db, b.tenant_id as string)) : 0;
  const pi = await provider.createPaymentIntent({
    amountMinor: input.amountMinor, currency: b.currency as CurrencyCode, captureMethod: "automatic", providerCustomerId: pm.provider_customer_id as string,
    paymentMethodId: pm.provider_payment_method_id as string, offSession: true, idempotencyKey: input.idempotencyKey,
    ...(fee ? { applicationFeeMinor: fee } : {}), ...(acct ? { connectedAccountId: acct } : {}),
    metadata: { tenantId: b.tenant_id as string, bookingId: b.id as string, purpose: input.purpose === "RENTAL" ? "RENTAL" : input.purpose },
  });
  must(await db.from("payments").upsert({
    tenant_id: b.tenant_id, booking_id: b.id, customer_id: b.customer_id, purpose: input.purpose === "RENTAL" ? "RENTAL" : input.purpose, provider: provider.name,
    provider_payment_id: pi.providerPaymentId, amount_minor: input.amountMinor, application_fee_minor: fee, currency: b.currency,
    status: "PROCESSING", idempotency_key: input.idempotencyKey, is_test: provider.mode === "test",
    ...(input.purpose === "DAMAGE" || input.purpose === "LATE_FEE" ? { approved_by: input.approvedBy } : {}),
  }, { onConflict: "tenant_id,idempotency_key" }).select("id").single());
  return { providerPaymentId: pi.providerPaymentId, status: pi.status };
}

/** Cron: authorize deposits whose authorize_after has arrived. */
export async function authorizeDueDeposits(db: SupabaseClient, provider: PaymentProvider, limit = 50) {
  const { data } = await db.from("security_deposits").select("booking_id, bookings!inner(status)")
    .in("status", ["PENDING", "METHOD_SAVED"]).lte("authorize_after", new Date().toISOString()).limit(limit);
  let ok = 0, failed = 0;
  for (const d of (data ?? []) as Row[]) {
    const status = ((d.bookings as Row | null)?.status ?? "") as string;
    if (!["CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP", "PENDING_APPROVAL"].includes(status)) continue;
    try { await authorizeDeposit(db, provider, d.booking_id as string); ok++; } catch { failed++; }
  }
  return { ok, failed };
}

/** Cron: refund what customers are owed after a cancellation (paid − refunded − fee). */
export async function refundCancelledBookings(db: SupabaseClient, provider: PaymentProvider, limit = 50) {
  const { data } = await db.from("bookings").select("id,tenant_id,amount_paid_minor,amount_refunded_minor,cancellation_fee_minor")
    .eq("status", "CANCELLED").gt("amount_paid_minor", 0).limit(limit);
  let refunded = 0;
  for (const b of (data ?? []) as Row[]) {
    const owed = Number(b.amount_paid_minor) - Number(b.amount_refunded_minor) - Number(b.cancellation_fee_minor ?? 0);
    if (owed <= 0) continue;
    const { data: pays } = await db.from("payments").select("id,amount_captured_minor,amount_refunded_minor").eq("booking_id", b.id).eq("purpose", "RENTAL").eq("status", "SUCCEEDED");
    let remaining = owed;
    for (const p of (pays ?? []) as Row[]) {
      const refundable = Number(p.amount_captured_minor) - Number(p.amount_refunded_minor);
      const amount = Math.min(refundable, remaining);
      if (amount <= 0) continue;
      await refundPayment(db, provider, { paymentId: p.id as string, amountMinor: amount, reason: "CANCELLATION", actorId: null, idempotencyKey: `cancel-refund:${b.id}:${p.id}` });
      remaining -= amount;
      refunded += amount;
    }
  }
  return { refundedMinor: refunded };
}
