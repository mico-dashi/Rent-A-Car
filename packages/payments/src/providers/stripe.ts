import Stripe from "stripe";
import type { CreatePaymentIntentInput, NormalizedEvent, NormalizedEventType, PaymentIntentResult, PaymentProvider, RefundInput } from "../types";
import { WebhookSignatureError } from "../types";

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  /** Guard: refuse live keys when PAYMENTS_MODE=test and vice versa. */
  mode: "test" | "live";
  client?: Stripe;
}

function toResult(pi: Stripe.PaymentIntent): PaymentIntentResult {
  return {
    providerPaymentId: pi.id,
    status: pi.status,
    clientSecret: pi.client_secret,
    amountMinor: pi.amount,
    amountCapturableMinor: pi.amount_capturable,
  };
}

const EVENT_MAP: Record<string, NormalizedEventType> = {
  "payment_intent.succeeded": "payment.succeeded",
  "payment_intent.payment_failed": "payment.failed",
  "payment_intent.amount_capturable_updated": "payment.authorized",
  "payment_intent.canceled": "payment.canceled",
  "charge.refund.updated": "refund.succeeded",
  "refund.updated": "refund.succeeded",
  "refund.failed": "refund.failed",
  "setup_intent.succeeded": "setup.succeeded",
  "account.updated": "account.updated",
};

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly mode: "test" | "live";
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(opts: StripeProviderOptions) {
    const isLiveKey = opts.secretKey.startsWith("sk_live_") || opts.secretKey.startsWith("rk_live_");
    if (opts.mode === "test" && isLiveKey) throw new Error("Live Stripe key supplied while PAYMENTS_MODE=test");
    if (opts.mode === "live" && !isLiveKey) throw new Error("Test Stripe key supplied while PAYMENTS_MODE=live");
    this.mode = opts.mode;
    this.webhookSecret = opts.webhookSecret;
    this.stripe = opts.client ?? new Stripe(opts.secretKey, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "rental-platform" } });
  }

  private account(id?: string): Stripe.RequestOptions {
    return id ? { stripeAccount: id } : {};
  }

  async createCustomer(input: { email: string; name: string; idempotencyKey: string; connectedAccountId?: string; metadata: Record<string, string> }) {
    const c = await this.stripe.customers.create(
      { email: input.email, name: input.name, metadata: input.metadata },
      { idempotencyKey: input.idempotencyKey, ...this.account(input.connectedAccountId) },
    );
    return { providerCustomerId: c.id };
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    const params: Stripe.PaymentIntentCreateParams = {
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
      capture_method: input.captureMethod,
      automatic_payment_methods: input.paymentMethodId ? undefined : { enabled: true }, // Apple Pay / Google Pay where supported
      metadata: input.metadata,
      ...(input.description ? { description: input.description } : {}),
      ...(input.providerCustomerId ? { customer: input.providerCustomerId } : {}),
      ...(input.paymentMethodId ? { payment_method: input.paymentMethodId, confirm: true } : {}),
      ...(input.offSession ? { off_session: true } : {}),
      ...(input.saveForFutureUse ? { setup_future_usage: "off_session" as const } : {}),
      ...(input.applicationFeeMinor && input.connectedAccountId ? { application_fee_amount: input.applicationFeeMinor } : {}),
    };
    const pi = await this.stripe.paymentIntents.create(params, { idempotencyKey: input.idempotencyKey, ...this.account(input.connectedAccountId) });
    return toResult(pi);
  }

  async createSetupIntent(input: { providerCustomerId: string; idempotencyKey: string; connectedAccountId?: string; metadata: Record<string, string> }) {
    const si = await this.stripe.setupIntents.create(
      { customer: input.providerCustomerId, usage: "off_session", metadata: input.metadata, automatic_payment_methods: { enabled: true } },
      { idempotencyKey: input.idempotencyKey, ...this.account(input.connectedAccountId) },
    );
    if (!si.client_secret) throw new Error("Stripe returned no client secret");
    return { id: si.id, clientSecret: si.client_secret };
  }

  async capture(input: { providerPaymentId: string; amountMinor?: number; idempotencyKey: string; connectedAccountId?: string }) {
    const pi = await this.stripe.paymentIntents.capture(
      input.providerPaymentId,
      input.amountMinor !== undefined ? { amount_to_capture: input.amountMinor } : {},
      { idempotencyKey: input.idempotencyKey, ...this.account(input.connectedAccountId) },
    );
    return toResult(pi);
  }

  async cancel(input: { providerPaymentId: string; idempotencyKey: string; connectedAccountId?: string }) {
    const pi = await this.stripe.paymentIntents.cancel(input.providerPaymentId, {}, { idempotencyKey: input.idempotencyKey, ...this.account(input.connectedAccountId) });
    return toResult(pi);
  }

  async refund(input: RefundInput) {
    const r = await this.stripe.refunds.create(
      { payment_intent: input.providerPaymentId, amount: input.amountMinor, metadata: input.metadata, ...(input.reason ? { reason: input.reason } : {}) },
      { idempotencyKey: input.idempotencyKey, ...this.account(input.connectedAccountId) },
    );
    const status = r.status === "succeeded" || r.status === "failed" || r.status === "canceled" ? r.status : "pending";
    return { providerRefundId: r.id, status } as const;
  }

  async getPaymentMethod(input: { paymentMethodId: string; connectedAccountId?: string }) {
    const pm = await this.stripe.paymentMethods.retrieve(input.paymentMethodId, {}, this.account(input.connectedAccountId));
    const wallet = pm.card?.wallet?.type;
    return {
      id: pm.id,
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
      wallet: wallet === "apple_pay" || wallet === "google_pay" ? wallet : null,
    };
  }

  async createConnectedAccount(input: { email: string; country: string; businessName: string; idempotencyKey: string; metadata: Record<string, string> }) {
    const a = await this.stripe.accounts.create(
      { type: "express", email: input.email, country: input.country, business_profile: { name: input.businessName }, metadata: input.metadata,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } } },
      { idempotencyKey: input.idempotencyKey },
    );
    return { accountId: a.id };
  }

  async createAccountLink(input: { accountId: string; refreshUrl: string; returnUrl: string }) {
    const l = await this.stripe.accountLinks.create({ account: input.accountId, refresh_url: input.refreshUrl, return_url: input.returnUrl, type: "account_onboarding" });
    return { url: l.url };
  }

  verifyWebhook(rawBody: string, signatureHeader: string | null): NormalizedEvent {
    if (!signatureHeader) throw new WebhookSignatureError();
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    } catch {
      throw new WebhookSignatureError();
    }
    return normalizeStripeEvent(event);
  }
}

export function normalizeStripeEvent(event: Stripe.Event): NormalizedEvent {
  let type = EVENT_MAP[event.type] ?? "ignored";
  const base = { provider: "stripe", eventId: event.id, rawType: event.type, livemode: event.livemode, payload: event };
  const obj = event.data.object as unknown as Record<string, unknown>;
  const metadata = (obj.metadata as Record<string, string> | undefined) ?? {};

  if (event.type.startsWith("payment_intent.")) {
    const pi = event.data.object as Stripe.PaymentIntent;
    return {
      ...base, type, metadata,
      providerPaymentId: pi.id,
      amountMinor: type === "payment.authorized" ? pi.amount_capturable : pi.amount_received || pi.amount,
      currency: pi.currency.toUpperCase(),
      ...(typeof pi.customer === "string" ? { providerCustomerId: pi.customer } : {}),
      ...(typeof pi.payment_method === "string" ? { paymentMethodId: pi.payment_method } : {}),
      ...(pi.last_payment_error?.code ? { failureCode: pi.last_payment_error.code } : {}),
      ...(pi.last_payment_error?.message ? { failureMessage: pi.last_payment_error.message } : {}),
      ...(event.account ? { providerAccountId: event.account } : {}),
    };
  }
  if (event.type === "refund.updated" || event.type === "charge.refund.updated" || event.type === "refund.failed") {
    const r = event.data.object as Stripe.Refund;
    if (r.status === "failed" || r.status === "canceled") type = "refund.failed";
    else if (r.status !== "succeeded") type = "ignored";
    return {
      ...base, type, metadata,
      providerRefundId: r.id,
      amountMinor: r.amount,
      currency: r.currency.toUpperCase(),
      ...(typeof r.payment_intent === "string" ? { providerPaymentId: r.payment_intent } : {}),
    };
  }
  if (event.type === "setup_intent.succeeded") {
    const si = event.data.object as Stripe.SetupIntent;
    return {
      ...base, type, metadata,
      ...(typeof si.customer === "string" ? { providerCustomerId: si.customer } : {}),
      ...(typeof si.payment_method === "string" ? { paymentMethodId: si.payment_method } : {}),
      ...(event.account ? { providerAccountId: event.account } : {}),
    };
  }
  if (event.type === "account.updated") {
    const a = event.data.object as Stripe.Account;
    return { ...base, type, metadata, providerAccountId: a.id };
  }
  return { ...base, type, metadata };
}
