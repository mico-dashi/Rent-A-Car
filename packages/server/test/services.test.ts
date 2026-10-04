import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO } from "@rental/testing";
import { syncInspection, syncInspectionPhoto, type InspectionDraft } from "@rental/api-client";
import type { ChannelSender, OutboundMessage } from "@rental/notifications";
import type { PaymentProvider } from "@rental/payments";
import {
  createStaffBooking, dispatchNotifications, runScheduledJobs, applyDataRetention, startIdentityVerification, webhookHandlers, generateAgreement, issueInvoice, modifyBookingDates, refundPayment, signAgreement, signedDocumentUrl,
} from "../src";

/**
 * Runs against the local stack (tools/local-stack): real PostgREST, GoTrue and
 * the RLS-enforcing storage emulator. Start it first: `pnpm stack:up`.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
let db: SupabaseClient;

const PNG = "data:image/png;base64," + Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000100000001008060000001ff3ff610000004f4944415478da63fc0f040c0c0c4c0c0c0c0c0c0c0c0c0c0c0cff19181818181818181818181818181818fe33303030303030303030303030303030fc6760606060606060606060606060606060f8cf0000d3b30f01e8e3c3a40000000049454e44ae426082".padEnd(260, "0"),
  "hex").toString("base64");

/** Random far-future window base so the suite can re-run against the same database. */
const BASE = 2000 + Math.floor(Math.random() * 3000);

function day(offset: number, hour = 10) {
  const d = new Date(Date.now() + offset * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

class RecordingSender implements ChannelSender {
  constructor(readonly channel: "EMAIL" | "PUSH" | "SMS") {}
  sent: OutboundMessage[] = [];
  async send(m: OutboundMessage) { this.sent.push(m); return { providerMessageId: `test-${this.sent.length}` }; }
}

/** Test double for the provider port (records calls; succeeds deterministically). */
function testProvider(calls: string[]): PaymentProvider {
  const ok = async () => ({ providerPaymentId: "pi_test", status: "succeeded" as const, clientSecret: null, amountMinor: 0, amountCapturableMinor: 0 });
  return {
    name: "stripe", mode: "test",
    createCustomer: async () => ({ providerCustomerId: "cus_test" }),
    createPaymentIntent: ok, capture: ok, cancel: ok,
    createSetupIntent: async () => ({ id: "seti", clientSecret: "x" }),
    refund: async (i) => { calls.push(`refund:${i.amountMinor}:${i.idempotencyKey}`); return { providerRefundId: `re_${i.idempotencyKey}`, status: "succeeded" as const }; },
    getPaymentMethod: async () => ({ id: "pm", brand: "visa", last4: "4242", expMonth: 1, expYear: 2030, wallet: null }),
    createConnectedAccount: async () => ({ accountId: "acct" }), createAccountLink: async () => ({ url: "https://x" }),
    createIdentitySession: async (i) => { calls.push(`idv:${i.metadata.customerId}`); return { id: `vs_${calls.length}`, url: "https://verify.stripe.com/start/test" }; },
    verifyWebhook: () => { throw new Error("n/a"); },
  };
}

beforeAll(() => {
  if (!url || !service) throw new Error("Start the local stack and export tools/local-stack/.data/stack.env");
  db = createClient(url, service, { auth: { persistSession: false } });
});
afterAll(() => undefined);

describe("staff booking lifecycle services", () => {
  let bookingId: string;

  it("creates a priced booking for a customer (staff)", async () => {
    const b = await createStaffBooking(db, DEMO.tenant, DEMO.owner, {
      tenantId: DEMO.tenant, customerId: DEMO.customer, vehicleId: DEMO.porsche911, pickupBranchId: DEMO.cityBranch, returnBranchId: DEMO.cityBranch,
      startsAt: day(BASE), endsAt: day(BASE + 3), pickupType: "BRANCH", additionalDrivers: 0, extras: [], initialStatus: "CONFIRMED", idempotencyKey: randomUUID(),
    });
    bookingId = b.id;
    expect(b.status).toBe("CONFIRMED");
    const { data } = await db.from("bookings").select("total_minor,deposit_minor").eq("id", b.id).single();
    const { data: lines } = await db.from("booking_price_lines").select("amount_minor").eq("booking_id", b.id);
    expect(lines!.reduce((a, l) => a + Number(l.amount_minor), 0)).toBe(Number(data!.total_minor));
    const { data: dep } = await db.from("security_deposits").select("amount_minor,status").eq("booking_id", b.id).single();
    expect(dep).toEqual({ amount_minor: 300000, status: "PENDING" });
  });

  it("re-prices when dates change and keeps the occupancy consistent", async () => {
    const before = (await db.from("bookings").select("total_minor").eq("id", bookingId).single()).data!.total_minor;
    const r = await modifyBookingDates(db, DEMO.owner, { bookingId, startsAt: day(BASE), endsAt: day(BASE + 5) });
    expect(r.total_minor).toBeGreaterThan(Number(before));
    const { data: blk } = await db.from("vehicle_availability_blocks").select("period").eq("booking_id", bookingId).is("released_at", null).single();
    expect(String(blk!.period)).toContain(day(BASE + 5).slice(0, 10));
  });

  it("generates an agreement PDF, binds signatures to its hash, and produces the signed copy", async () => {
    const a = await generateAgreement(db, bookingId);
    const again = await generateAgreement(db, bookingId);
    expect(again.id).toBe(a.id); // identical content => same agreement
    const pdfUrl = await signedDocumentUrl(db, a.pdf_path as string);
    const pdf = await fetch(pdfUrl.startsWith("http") ? pdfUrl : `${url}/storage/v1${pdfUrl}`);
    expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(1500);
    await signAgreement(db, { agreementId: a.id as string, role: "CUSTOMER", signerName: "Sam Taylor", signerUserId: DEMO.customerUser, pngDataUrl: PNG, ip: "203.0.113.5", userAgent: "vitest" });
    const done = await signAgreement(db, { agreementId: a.id as string, role: "EMPLOYEE", signerName: "Arben Hoxha", signerUserId: DEMO.owner, pngDataUrl: PNG, ip: "203.0.113.6", userAgent: "vitest" });
    expect(done.status).toBe("FULLY_SIGNED");
    const { data: fin } = await db.from("rental_agreements").select("pdf_path").eq("id", a.id).single();
    expect(fin!.pdf_path).toMatch(/-signed\.pdf$/);
    const { data: consent } = await db.from("consent_records").select("consent_type").eq("customer_id", DEMO.customer).eq("consent_type", "RENTAL_AGREEMENT");
    expect(consent!.length).toBeGreaterThan(0);
  });

  it("issues gap-free numbered invoices", async () => {
    const inv = await issueInvoice(db, bookingId);
    expect(inv.number).toMatch(/^APEXDR-INV-\d{4}-\d{5}$/);
    expect(Number(inv.total_minor)).toBe(Number(inv.subtotal_minor) + Number(inv.tax_minor));
    const same = await issueInvoice(db, bookingId);
    expect(same.id).toBe(inv.id);
  });

  it("refunds once, rejects over-refunds and settles booking totals", async () => {
    const calls: string[] = [];
    const provider = testProvider(calls);
    const { data: pay } = await db.from("payments").insert({
      tenant_id: DEMO.tenant, booking_id: bookingId, customer_id: DEMO.customer, purpose: "RENTAL", provider: "stripe", provider_payment_id: `pi_${randomUUID()}`,
      amount_minor: 50000, amount_captured_minor: 50000, currency: "EUR", status: "SUCCEEDED", idempotency_key: randomUUID(),
    }).select("id").single();
    await db.rpc("record_booking_payment", { p_booking: bookingId, p_amount_minor: 50000, p_payment_id: pay!.id });
    const key = randomUUID();
    await refundPayment(db, provider, { paymentId: pay!.id, amountMinor: 20000, reason: "goodwill", actorId: DEMO.owner, idempotencyKey: key });
    await refundPayment(db, provider, { paymentId: pay!.id, amountMinor: 20000, reason: "goodwill", actorId: DEMO.owner, idempotencyKey: key }); // replay
    await expect(refundPayment(db, provider, { paymentId: pay!.id, amountMinor: 40000, reason: "too much", actorId: DEMO.owner, idempotencyKey: randomUUID() }))
      .rejects.toThrow(/exceeds captured/);
    const { data: b } = await db.from("bookings").select("amount_paid_minor,amount_refunded_minor,payment_status").eq("id", bookingId).single();
    expect(calls).toHaveLength(1);
    expect(b).toEqual({ amount_paid_minor: 50000, amount_refunded_minor: 20000, payment_status: "PARTIALLY_REFUNDED" });
  });
});

describe("notification dispatch", () => {
  it("renders templates in the recipient language, delivers in-app, fails loudly without a channel", async () => {
    const email = new RecordingSender("EMAIL");
    const res = await dispatchNotifications(db, { EMAIL: email }, 200);
    expect(res.sent).toBeGreaterThan(0);
    const confirmation = email.sent.find((m) => m.subject?.includes("is confirmed"));
    expect(confirmation?.to).toBe("customer@example.demo");
    expect(confirmation?.text).not.toContain("{{");
    const { data: inApp } = await db.from("notifications").select("status,body").eq("channel", "IN_APP").eq("event", "booking.confirmed").limit(1).single();
    expect(inApp!.status).toBe("DELIVERED");
    expect(inApp!.body.length).toBeGreaterThan(5);
    const { count } = await db.from("notifications").select("*", { count: "exact", head: true }).eq("channel", "PUSH").eq("status", "FAILED");
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe("scheduler tick", () => {
  it("runs every job in isolation, verifies domains and skips payments when unconfigured", async () => {
    const hostname = `e2e-${randomUUID().slice(0, 8)}.example.test`;
    const token = randomUUID();
    const { error } = await db.from("tenant_domains").insert({ tenant_id: DEMO.tenant, hostname, verification_token: token });
    expect(error).toBeNull();
    const attached: string[] = [];
    const results = await runScheduledJobs(db, {
      provider: null,
      senders: { EMAIL: new RecordingSender("EMAIL"), PUSH: new RecordingSender("PUSH") },
      hosting: { addDomain: async (h) => { attached.push(h); }, removeDomain: async () => {} },
      txtLookup: async (name) => (name === `_rental-verify.${hostname}` ? [[token]] : []),
    });
    for (const [job, r] of Object.entries(results)) expect(r.ok, `${job}: ${JSON.stringify(r)}`).toBe(true);
    expect(results.authorizeDeposits).toEqual({ ok: true, skipped: "payments not configured" });
    expect(attached).toEqual([hostname]);
    const { data } = await db.from("tenant_domains").select("status").eq("hostname", hostname).single();
    expect(data?.status).toBe("VERIFIED");
  });
});

describe("offline inspection sync (staff session, RLS)", () => {
  it("creates, updates, detects version conflicts, uploads photos idempotently and enforces customer acceptance", async () => {
    const offset = 300 + Math.floor(Math.random() * 1500);
    const b = await createStaffBooking(db, DEMO.tenant, DEMO.owner, {
      tenantId: DEMO.tenant, customerId: DEMO.customer, vehicleId: DEMO.porsche911, pickupBranchId: DEMO.cityBranch, returnBranchId: DEMO.cityBranch,
      startsAt: day(offset), endsAt: day(offset + 2), pickupType: "BRANCH", additionalDrivers: 0, extras: [], initialStatus: "CONFIRMED", idempotencyKey: randomUUID(),
    });
    const staff = createClient(url, anon, { auth: { persistSession: false } });
    const { error: signInError } = await staff.auth.signInWithPassword({ email: "staff@apexdrive.demo", password: "DemoPassw0rd!" });
    expect(signInError).toBeNull();
    const { data: odo } = await db.from("vehicles").select("odometer_km").eq("id", DEMO.porsche911).single();

    const draft: InspectionDraft = {
      id: randomUUID(), tenantId: DEMO.tenant, bookingId: b.id, vehicleId: DEMO.porsche911, kind: "PICKUP", odometerKm: Number(odo!.odometer_km) + 1,
      fuelEighths: 8, batteryPct: null, checklist: { FRONT: true }, notes: "offline", customerAccepted: false, submit: false,
      performedBy: DEMO.employee, performedAt: new Date().toISOString(),
    };
    const created = await syncInspection(staff, draft, null);
    expect(created).toEqual({ ok: true, version: 1 });
    // A lost response + retry of the same op edits our own record instead of failing.
    expect(await syncInspection(staff, { ...draft, notes: "retry" }, null)).toEqual({ ok: true, version: 2 });

    // Another device edited it meanwhile: an edit based on version 1 must not overwrite it.
    const stale = await syncInspection(staff, { ...draft, notes: "stale" }, 1);
    expect(stale).toMatchObject({ ok: false, kind: "conflict", error: "VERSION_CONFLICT", serverVersion: 2 });
    const { data: kept } = await db.from("vehicle_inspections").select("notes").eq("id", draft.id).single();
    expect(kept!.notes).toBe("retry");

    expect(await syncInspection(staff, { ...draft, submit: true }, 2)).toMatchObject({ ok: false, kind: "rejected", error: "CUSTOMER_ACCEPTANCE_REQUIRED" });
    expect(await syncInspection(staff, { ...draft, submit: true, customerAccepted: true }, 2)).toEqual({ ok: true, version: 3 });

    const photo = { id: randomUUID(), tenantId: DEMO.tenant, inspectionId: draft.id, slot: "FRONT" as const, contentType: "image/png" as const, capturedAt: new Date().toISOString(), sha256: null };
    const bytes = Buffer.from(PNG.split(",")[1]!, "base64");
    expect(await syncInspectionPhoto(staff, photo, bytes)).toEqual({ ok: true });
    expect(await syncInspectionPhoto(staff, photo, bytes)).toEqual({ ok: true });
    const { count } = await db.from("inspection_photos").select("id", { count: "exact", head: true }).eq("inspection_id", draft.id);
    expect(count).toBe(1);

    // Customers cannot write inspections.
    const customer = createClient(url, anon, { auth: { persistSession: false } });
    await customer.auth.signInWithPassword({ email: "customer@example.demo", password: "DemoPassw0rd!" });
    const denied = await syncInspection(customer, { ...draft, id: randomUUID(), kind: "RETURN", performedBy: DEMO.customerUser }, null);
    expect(denied).toMatchObject({ ok: false, kind: "rejected", error: "FORBIDDEN" });
  });
});

describe("data retention job", () => {
  it("anonymises an expired customer and deletes their stored ID images", async () => {
    const sql = new pg.Client({ connectionString: process.env.STACK_DATABASE_URL });
    await sql.connect();
    const email = `retention-${randomUUID().slice(0, 8)}@example.demo`;
    const { rows } = await sql.query(`insert into public.customers (tenant_id, first_name, last_name, email, created_at)
      values ($1, 'Old', 'Customer', $2, now() - interval '3000 days') returning id`, [DEMO.tenant, email]);
    const customerId = rows[0].id as string;
    const path = `${DEMO.tenant}/retention/${customerId}.png`;
    expect((await db.storage.from("customer-documents").upload(path, Buffer.from(PNG.split(",")[1]!, "base64"), { contentType: "image/png" })).error).toBeNull();
    await sql.query(`insert into public.driver_licenses (tenant_id, customer_id, license_number, issuing_country, expires_on, front_image_path)
      values ($1, $2, 'X1', 'AL', '2030-01-01', $3)`, [DEMO.tenant, customerId, path]);
    await sql.end();

    const r = await applyDataRetention(db);
    expect(r.customers).toBeGreaterThanOrEqual(1);
    expect(r.filesFailed).toEqual([]);
    const { data: c } = await db.from("customers").select("first_name,email,anonymized_at").eq("id", customerId).single();
    expect(c).toMatchObject({ first_name: "Deleted", email: `deleted+${customerId}@invalid.example` });
    expect((await db.storage.from("customer-documents").download(path)).error).not.toBeNull();
  });
});

describe("identity verification (Stripe Identity)", () => {
  it("marks the customer pending, then verified only for the session we started", async () => {
    const calls: string[] = [];
    const provider = testProvider(calls);
    const { data: cust } = await db.from("customers").insert({ tenant_id: DEMO.tenant, first_name: "Idv", last_name: "Test", email: `idv-${randomUUID().slice(0, 8)}@example.demo` }).select("id").single();
    const started = await startIdentityVerification(db, provider, { customerId: cust!.id, returnUrl: "https://apex.example/account" });
    expect(started).toEqual({ alreadyVerified: false, url: "https://verify.stripe.com/start/test" });
    const { data: pending } = await db.from("customers").select("identity_status,identity_provider,identity_provider_ref").eq("id", cust!.id).single();
    expect(pending).toMatchObject({ identity_status: "PENDING", identity_provider: "stripe_identity" });

    const h = webhookHandlers(db, provider);
    const event = (sessionId: string, type: "identity.verified" | "identity.requires_input") => ({
      provider: "stripe", eventId: randomUUID(), type, rawType: type, livemode: false, payload: {}, identitySessionId: sessionId,
      metadata: { tenantId: DEMO.tenant, customerId: cust!.id },
    });
    await h.onIdentityUpdated(event("vs_someone_else", "identity.verified")); // stale/foreign session: ignored
    expect((await db.from("customers").select("identity_status").eq("id", cust!.id).single()).data!.identity_status).toBe("PENDING");
    await h.onIdentityUpdated(event(pending!.identity_provider_ref as string, "identity.verified"));
    const { data: done } = await db.from("customers").select("identity_status,identity_verified_at").eq("id", cust!.id).single();
    expect(done!.identity_status).toBe("VERIFIED");
    expect(done!.identity_verified_at).not.toBeNull();
    expect(await startIdentityVerification(db, provider, { customerId: cust!.id, returnUrl: "https://x" })).toEqual({ alreadyVerified: true });
  });
});

describe("storage RLS via the gateway", () => {
  it("staff can read tenant documents; other users cannot", async () => {
    const sign = async (email: string) => {
      const c = createClient(url, anon, { auth: { persistSession: false } });
      const { error } = await c.auth.signInWithPassword({ email, password: "DemoPassw0rd!" });
      if (error) throw error;
      return c;
    };
    const { data: a } = await db.from("rental_agreements").select("pdf_path").neq("status", "VOID").limit(1).single();
    const owner = await sign("owner@apexdrive.demo");
    const customer = await sign("customer@example.demo");
    expect((await owner.storage.from("documents").download(a!.pdf_path as string)).error).toBeNull();
    expect((await customer.storage.from("documents").download(a!.pdf_path as string)).error).not.toBeNull();
  });
});
