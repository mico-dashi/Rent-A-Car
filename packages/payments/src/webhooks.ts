import type { NormalizedEvent, PaymentProvider } from "./types";
import { WebhookSignatureError } from "./types";

/**
 * Persistence port for webhook processing. The Supabase implementation lives
 * in the web app's server code (service role); tests use an in-memory store.
 */
export interface WebhookStore {
  /** Insert the event; returns false if (provider, eventId) already exists. */
  recordEvent(event: NormalizedEvent): Promise<{ inserted: boolean; status: "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED" | "IGNORED" }>;
  /** Atomically claim the event for processing (prevents concurrent double-processing). */
  claim(provider: string, eventId: string): Promise<boolean>;
  markProcessed(provider: string, eventId: string): Promise<void>;
  markIgnored(provider: string, eventId: string): Promise<void>;
  markFailed(provider: string, eventId: string, error: string): Promise<void>;
}

export interface WebhookHandlers {
  onPaymentSucceeded(e: NormalizedEvent): Promise<void>;
  onPaymentFailed(e: NormalizedEvent): Promise<void>;
  onPaymentAuthorized(e: NormalizedEvent): Promise<void>;
  onPaymentCanceled(e: NormalizedEvent): Promise<void>;
  onRefundSucceeded(e: NormalizedEvent): Promise<void>;
  onRefundFailed(e: NormalizedEvent): Promise<void>;
  onSetupSucceeded(e: NormalizedEvent): Promise<void>;
  onAccountUpdated(e: NormalizedEvent): Promise<void>;
  /** verified, requires_input (failed or abandoned; the customer may retry) or canceled. */
  onIdentityUpdated(e: NormalizedEvent): Promise<void>;
}

export type WebhookOutcome =
  | { httpStatus: 400; result: "invalid_signature" }
  | { httpStatus: 200; result: "duplicate" | "processed" | "ignored" | "mode_mismatch" }
  | { httpStatus: 500; result: "failed" };

/**
 * Verify → persist → claim → dispatch → mark. Returns 2xx for duplicates so
 * the provider stops retrying, and 5xx on handler failure so it retries.
 * Handlers must themselves be idempotent (they are keyed by provider ids).
 */
export async function processWebhook(
  provider: PaymentProvider,
  rawBody: string,
  signature: string | null,
  store: WebhookStore,
  handlers: WebhookHandlers,
): Promise<WebhookOutcome> {
  let event: NormalizedEvent;
  try {
    event = provider.verifyWebhook(rawBody, signature);
  } catch (e) {
    if (e instanceof WebhookSignatureError) return { httpStatus: 400, result: "invalid_signature" };
    throw e;
  }

  if (event.livemode !== (provider.mode === "live")) {
    // A test event hitting production (or vice versa) must never move money state.
    return { httpStatus: 200, result: "mode_mismatch" };
  }

  const recorded = await store.recordEvent(event);
  if (!recorded.inserted && (recorded.status === "PROCESSED" || recorded.status === "IGNORED")) {
    return { httpStatus: 200, result: "duplicate" };
  }
  if (!(await store.claim(event.provider, event.eventId))) {
    return { httpStatus: 200, result: "duplicate" };
  }

  try {
    switch (event.type) {
      case "payment.succeeded": await handlers.onPaymentSucceeded(event); break;
      case "payment.failed": await handlers.onPaymentFailed(event); break;
      case "payment.authorized": await handlers.onPaymentAuthorized(event); break;
      case "payment.canceled": await handlers.onPaymentCanceled(event); break;
      case "refund.succeeded": await handlers.onRefundSucceeded(event); break;
      case "refund.failed": await handlers.onRefundFailed(event); break;
      case "setup.succeeded": await handlers.onSetupSucceeded(event); break;
      case "account.updated": await handlers.onAccountUpdated(event); break;
      case "identity.verified":
      case "identity.requires_input":
      case "identity.canceled": await handlers.onIdentityUpdated(event); break;
      case "ignored":
        await store.markIgnored(event.provider, event.eventId);
        return { httpStatus: 200, result: "ignored" };
    }
    await store.markProcessed(event.provider, event.eventId);
    return { httpStatus: 200, result: "processed" };
  } catch (e) {
    await store.markFailed(event.provider, event.eventId, e instanceof Error ? e.message : "unknown");
    return { httpStatus: 500, result: "failed" };
  }
}
