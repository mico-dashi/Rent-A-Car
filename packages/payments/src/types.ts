import type { CurrencyCode } from "@rental/types";

export type CaptureMethod = "automatic" | "manual";

export interface CreatePaymentIntentInput {
  amountMinor: number;
  currency: CurrencyCode;
  providerCustomerId?: string;
  paymentMethodId?: string;
  captureMethod: CaptureMethod;
  /** Save the method for later off-session use (deposits, approved charges). */
  saveForFutureUse?: boolean;
  offSession?: boolean;
  /** Platform commission; routed via the connected account. */
  applicationFeeMinor?: number;
  connectedAccountId?: string;
  idempotencyKey: string;
  description?: string;
  metadata: Record<string, string>;
}

export interface PaymentIntentResult {
  providerPaymentId: string;
  status: "requires_payment_method" | "requires_confirmation" | "requires_action" | "processing" | "requires_capture" | "succeeded" | "canceled";
  clientSecret: string | null;
  amountMinor: number;
  amountCapturableMinor: number;
}

export interface RefundInput {
  providerPaymentId: string;
  amountMinor: number;
  idempotencyKey: string;
  reason?: "requested_by_customer" | "duplicate" | "fraudulent";
  connectedAccountId?: string;
  metadata: Record<string, string>;
}

export type NormalizedEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.authorized"
  | "payment.canceled"
  | "refund.succeeded"
  | "refund.failed"
  | "setup.succeeded"
  | "account.updated"
  | "ignored";

export interface NormalizedEvent {
  provider: string;
  eventId: string;
  type: NormalizedEventType;
  rawType: string;
  providerPaymentId?: string;
  providerRefundId?: string;
  providerAccountId?: string;
  amountMinor?: number;
  currency?: string;
  failureCode?: string;
  failureMessage?: string;
  metadata: Record<string, string>;
  livemode: boolean;
  payload: unknown;
}

export class WebhookSignatureError extends Error {
  constructor() {
    super("Invalid webhook signature");
    this.name = "WebhookSignatureError";
  }
}

/** Every payment provider implements this; Stripe is the first. */
export interface PaymentProvider {
  readonly name: string;
  readonly mode: "test" | "live";
  createCustomer(input: { email: string; name: string; idempotencyKey: string; connectedAccountId?: string; metadata: Record<string, string> }): Promise<{ providerCustomerId: string }>;
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  createSetupIntent(input: { providerCustomerId: string; idempotencyKey: string; connectedAccountId?: string; metadata: Record<string, string> }): Promise<{ id: string; clientSecret: string }>;
  capture(input: { providerPaymentId: string; amountMinor?: number; idempotencyKey: string; connectedAccountId?: string }): Promise<PaymentIntentResult>;
  cancel(input: { providerPaymentId: string; idempotencyKey: string; connectedAccountId?: string }): Promise<PaymentIntentResult>;
  refund(input: RefundInput): Promise<{ providerRefundId: string; status: "pending" | "succeeded" | "failed" | "canceled" }>;
  /** Throws WebhookSignatureError when the signature is missing or wrong. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): NormalizedEvent;
}
