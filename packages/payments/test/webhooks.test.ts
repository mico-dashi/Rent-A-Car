import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { StripeProvider } from "../src/providers/stripe";
import { processWebhook, type WebhookHandlers, type WebhookStore } from "../src/webhooks";
import type { NormalizedEvent } from "../src/types";

const secret = "whsec_test_secret";
const stripe = new Stripe("sk_test_dummy");
const provider = new StripeProvider({ secretKey: "sk_test_dummy", webhookSecret: secret, mode: "test", client: stripe });

function signed(event: object) {
  const payload = JSON.stringify(event);
  return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret }) };
}

function piEvent(id: string, type = "payment_intent.succeeded", livemode = false) {
  return {
    id, object: "event", type, livemode, api_version: "2024-06-20", created: 1, pending_webhooks: 1, request: null,
    data: { object: { id: "pi_1", object: "payment_intent", amount: 5000, amount_received: 5000, amount_capturable: 0, currency: "eur", metadata: { bookingId: "b1" }, status: "succeeded", last_payment_error: null } },
  };
}

class MemoryStore implements WebhookStore {
  events = new Map<string, { status: "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED" | "IGNORED"; error?: string }>();
  async recordEvent(e: NormalizedEvent) {
    const existing = this.events.get(e.eventId);
    if (existing) return { inserted: false, status: existing.status };
    this.events.set(e.eventId, { status: "RECEIVED" });
    return { inserted: true, status: "RECEIVED" as const };
  }
  async claim(_p: string, id: string) {
    const e = this.events.get(id)!;
    if (e.status === "PROCESSING" || e.status === "PROCESSED") return false;
    e.status = "PROCESSING";
    return true;
  }
  async markProcessed(_p: string, id: string) { this.events.get(id)!.status = "PROCESSED"; }
  async markIgnored(_p: string, id: string) { this.events.get(id)!.status = "IGNORED"; }
  async markFailed(_p: string, id: string, error: string) { this.events.set(id, { status: "FAILED", error }); }
}

function handlers(calls: string[], failOnce = false): WebhookHandlers {
  let failed = false;
  const h = (name: string) => async () => {
    if (failOnce && !failed) { failed = true; throw new Error("db down"); }
    calls.push(name);
  };
  return {
    onPaymentSucceeded: h("succeeded"), onPaymentFailed: h("failed"), onPaymentAuthorized: h("authorized"),
    onPaymentCanceled: h("canceled"), onRefundSucceeded: h("refund"), onRefundFailed: h("refund_failed"),
    onSetupSucceeded: h("setup"), onAccountUpdated: h("account"), onIdentityUpdated: h("identity"),
  };
}

describe("payment webhooks", () => {
  it("rejects missing or forged signatures", async () => {
    const { payload } = signed(piEvent("evt_1"));
    const store = new MemoryStore();
    expect((await processWebhook(provider, payload, null, store, handlers([]))).httpStatus).toBe(400);
    expect((await processWebhook(provider, payload, "t=1,v1=deadbeef", store, handlers([]))).httpStatus).toBe(400);
    const tampered = signed(piEvent("evt_1"));
    expect((await processWebhook(provider, tampered.payload.replace("5000", "1"), tampered.header, store, handlers([]))).httpStatus).toBe(400);
    expect(store.events.size).toBe(0);
  });

  it("processes a verified event exactly once across retries", async () => {
    const { payload, header } = signed(piEvent("evt_2"));
    const store = new MemoryStore();
    const calls: string[] = [];
    const first = await processWebhook(provider, payload, header, store, handlers(calls));
    const second = await processWebhook(provider, payload, header, store, handlers(calls));
    expect(first.result).toBe("processed");
    expect(second.result).toBe("duplicate");
    expect(calls).toEqual(["succeeded"]);
  });

  it("returns 500 on handler failure so the provider retries, then succeeds", async () => {
    const { payload, header } = signed(piEvent("evt_3"));
    const store = new MemoryStore();
    const calls: string[] = [];
    const h = handlers(calls, true);
    expect((await processWebhook(provider, payload, header, store, h)).httpStatus).toBe(500);
    expect(store.events.get("evt_3")?.status).toBe("FAILED");
    expect((await processWebhook(provider, payload, header, store, h)).result).toBe("processed");
    expect(calls).toEqual(["succeeded"]);
  });

  it("ignores live events in test mode", async () => {
    const { payload, header } = signed(piEvent("evt_4", "payment_intent.succeeded", true));
    expect((await processWebhook(provider, payload, header, new MemoryStore(), handlers([]))).result).toBe("mode_mismatch");
  });

  it("normalises authorisations with the capturable amount", async () => {
    const e = piEvent("evt_5", "payment_intent.amount_capturable_updated");
    (e.data.object as Record<string, unknown>).amount_capturable = 300_000;
    const { payload, header } = signed(e);
    const n = provider.verifyWebhook(payload, header);
    expect(n).toMatchObject({ type: "payment.authorized", amountMinor: 300_000, currency: "EUR", metadata: { bookingId: "b1" } });
  });

  it("normalises Stripe Identity sessions and routes them to the identity handler", async () => {
    const idv = (id: string, type: string, lastError: object | null) => ({
      id, object: "event", type, livemode: false, api_version: "2024-06-20", created: 1, pending_webhooks: 1, request: null,
      data: { object: { id: "vs_1", object: "identity.verification_session", status: type.split(".").pop(), last_error: lastError, metadata: { tenantId: "t1", customerId: "c1" } } },
    });
    const ok = signed(idv("evt_i1", "identity.verification_session.verified", null));
    expect(provider.verifyWebhook(ok.payload, ok.header)).toMatchObject({ type: "identity.verified", identitySessionId: "vs_1", metadata: { tenantId: "t1", customerId: "c1" } });
    const bad = signed(idv("evt_i2", "identity.verification_session.requires_input", { code: "document_expired", reason: "The document is expired." }));
    expect(provider.verifyWebhook(bad.payload, bad.header)).toMatchObject({ type: "identity.requires_input", failureCode: "document_expired" });
    const calls: string[] = [];
    expect((await processWebhook(provider, ok.payload, ok.header, new MemoryStore(), handlers(calls))).result).toBe("processed");
    expect(calls).toEqual(["identity"]);
  });

  it("refuses to run with mismatched key mode", () => {
    expect(() => new StripeProvider({ secretKey: "sk_live_x", webhookSecret: secret, mode: "test" })).toThrow(/Live Stripe key/);
  });
});
