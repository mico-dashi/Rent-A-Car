import "server-only";
import { StripeProvider, type NormalizedEvent, type PaymentProvider, type WebhookHandlers, type WebhookStore } from "@rental/payments";
import type { SupabaseClient } from "@rental/auth";
import { serverEnv } from "./env";

/** Returns null when payments are not configured — callers must refuse to take bookings that need payment. */
export function paymentProvider(): PaymentProvider | null {
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return null;
  return new StripeProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, mode: env.PAYMENTS_MODE });
}

export function supabaseWebhookStore(db: SupabaseClient): WebhookStore {
  return {
    async recordEvent(e) {
      const tenantId = e.metadata.tenantId ?? null;
      const { error } = await db.from("webhook_events").insert({
        provider: e.provider, event_id: e.eventId, event_type: e.rawType, tenant_id: tenantId, payload: e.payload, signature_verified: true,
      });
      if (!error) return { inserted: true, status: "RECEIVED" };
      if (error.code !== "23505") throw new Error(error.message);
      const { data } = await db.from("webhook_events").select("status").eq("provider", e.provider).eq("event_id", e.eventId).single();
      return { inserted: false, status: (data?.status ?? "RECEIVED") as "RECEIVED" };
    },
    async claim(provider, eventId) {
      // Conditional update = atomic claim; stale PROCESSING claims (>5 min) may be retried.
      const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data, error } = await db.from("webhook_events")
        .update({ status: "PROCESSING", processed_at: new Date().toISOString() })
        .eq("provider", provider).eq("event_id", eventId)
        .or(`status.in.(RECEIVED,FAILED),and(status.eq.PROCESSING,processed_at.lt.${staleBefore})`)
        .select("id");
      if (error) throw new Error(error.message);
      if (data?.length) await db.rpc("increment_webhook_attempts", { p_provider: provider, p_event_id: eventId });
      return (data?.length ?? 0) > 0;
    },
    async markProcessed(provider, eventId) {
      await db.from("webhook_events").update({ status: "PROCESSED", processed_at: new Date().toISOString(), last_error: null }).eq("provider", provider).eq("event_id", eventId);
    },
    async markIgnored(provider, eventId) {
      await db.from("webhook_events").update({ status: "IGNORED", processed_at: new Date().toISOString() }).eq("provider", provider).eq("event_id", eventId);
    },
    async markFailed(provider, eventId, error) {
      await db.from("webhook_events").update({ status: "FAILED", last_error: error.slice(0, 500) }).eq("provider", provider).eq("event_id", eventId);
    },
  };
}

async function paymentByProviderId(db: SupabaseClient, providerPaymentId: string) {
  const { data, error } = await db.from("payments").select("*").eq("provider", "stripe").eq("provider_payment_id", providerPaymentId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

async function ledger(db: SupabaseClient, payment: Record<string, unknown>, e: NormalizedEvent, kind: string, status: string) {
  const { error } = await db.from("payment_transactions").insert({
    tenant_id: payment.tenant_id, payment_id: payment.id, kind, status, amount_minor: e.amountMinor ?? 0,
    currency: e.currency ?? payment.currency, provider_transaction_id: e.providerRefundId ?? e.providerPaymentId, provider_event_id: e.eventId,
  });
  if (error && error.code !== "23505") throw new Error(error.message); // duplicate ledger row = already applied
}

export function webhookHandlers(db: SupabaseClient, provider: PaymentProvider): WebhookHandlers {
  return {
    async onPaymentSucceeded(e) {
      const payment = await paymentByProviderId(db, e.providerPaymentId!);
      if (!payment) throw new Error("Unknown payment " + e.providerPaymentId);
      await db.from("payments").update({ status: "SUCCEEDED", amount_captured_minor: e.amountMinor }).eq("id", payment.id);
      await ledger(db, payment, e, "CHARGE", "SUCCEEDED");
      if (payment.booking_id && payment.purpose === "RENTAL") {
        const { data, error } = await db.rpc("record_booking_payment", { p_booking: payment.booking_id, p_amount_minor: e.amountMinor, p_payment_id: payment.id });
        if (error) throw new Error(error.message);
        if ((data as { refund_required?: boolean })?.refund_required) {
          // Paid after the hold expired and the car was taken: refund in full automatically.
          const key = `auto-refund:${payment.id}`;
          const { error: refundError } = await db.from("refunds").insert({
            tenant_id: payment.tenant_id, payment_id: payment.id, booking_id: payment.booking_id, amount_minor: e.amountMinor,
            currency: payment.currency, reason: "HOLD_LOST", idempotency_key: key,
          });
          if (refundError && refundError.code !== "23505") throw new Error(refundError.message);
          await provider.refund({ providerPaymentId: e.providerPaymentId!, amountMinor: e.amountMinor!, idempotencyKey: key, metadata: { reason: "HOLD_LOST" } });
        }
      }
    },
    async onPaymentFailed(e) {
      const payment = await paymentByProviderId(db, e.providerPaymentId!);
      if (!payment) return;
      await db.from("payments").update({ status: "FAILED", failure_code: e.failureCode ?? null, failure_message: e.failureMessage?.slice(0, 300) ?? null }).eq("id", payment.id);
      await ledger(db, payment, e, "CHARGE", "FAILED");
    },
    async onPaymentAuthorized(e) {
      const payment = await paymentByProviderId(db, e.providerPaymentId!);
      if (!payment) return;
      await db.from("payments").update({ status: "AUTHORIZED" }).eq("id", payment.id);
      await ledger(db, payment, e, "AUTHORIZE", "SUCCEEDED");
      if (payment.purpose === "DEPOSIT" && payment.booking_id) {
        await db.from("security_deposits").update({ status: "AUTHORIZED", authorized_at: new Date().toISOString(), payment_id: payment.id })
          .eq("booking_id", payment.booking_id);
      }
    },
    async onPaymentCanceled(e) {
      const payment = await paymentByProviderId(db, e.providerPaymentId!);
      if (!payment) return;
      await db.from("payments").update({ status: "CANCELLED" }).eq("id", payment.id);
      await ledger(db, payment, e, "VOID", "SUCCEEDED");
      if (payment.purpose === "DEPOSIT" && payment.booking_id) {
        await db.from("security_deposits").update({ status: "RELEASED", released_at: new Date().toISOString() }).eq("booking_id", payment.booking_id);
      }
    },
    async onRefundSucceeded(e) {
      if (!e.providerRefundId) return;
      const { data: refund } = await db.from("refunds").select("*").eq("provider_refund_id", e.providerRefundId).maybeSingle();
      if (refund) await db.from("refunds").update({ status: "SUCCEEDED" }).eq("id", refund.id);
      const payment = e.providerPaymentId ? await paymentByProviderId(db, e.providerPaymentId) : null;
      if (payment) await ledger(db, payment, e, "REFUND", "SUCCEEDED");
    },
    async onRefundFailed(e) {
      if (!e.providerRefundId) return;
      await db.from("refunds").update({ status: "FAILED" }).eq("provider_refund_id", e.providerRefundId);
    },
    async onSetupSucceeded() {
      // Saved payment methods are persisted when the deposit authorisation job runs (Phase 11).
    },
    async onAccountUpdated(e) {
      if (!e.providerAccountId) return;
      const acct = e.payload as { data: { object: { charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean } } };
      await db.from("tenant_payment_accounts").update({
        charges_enabled: acct.data.object.charges_enabled, payouts_enabled: acct.data.object.payouts_enabled, details_submitted: acct.data.object.details_submitted,
      }).eq("provider", "stripe").eq("provider_account_id", e.providerAccountId);
    },
  };
}
