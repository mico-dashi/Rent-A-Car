import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, createPool, DEMO, errorOf, type Client, type Pool } from "@rental/testing";
import { bookingPayload, createBooking, DAY, window } from "./helpers";

let pool: Pool;
beforeAll(() => { pool = createPool(); });
afterAll(() => pool.end());

const as = async (c: Client, userId: string | null) => {
  await c.query("reset role");
  if (userId === null) {
    await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await c.query("set local role service_role");
  } else {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await c.query("set local role authenticated");
  }
};

describe("staff invitations", () => {
  it("owners invite; employees cannot; tokens are single-use and email-bound", async () => {
    const res = await asActor(pool, { kind: "user", userId: DEMO.employee }, async (c) => {
      const denied = await errorOf(c.query("select public.invite_staff($1, 'new@apexdrive.demo', 'EMPLOYEE')", [DEMO.tenant]));
      await as(c, DEMO.owner);
      const inv = (await c.query("select public.invite_staff($1, 'new@apexdrive.demo', 'MANAGER') r", [DEMO.tenant])).rows[0].r;
      const ownerRole = await errorOf(c.query("select public.invite_staff($1, 'x@y.demo', 'TENANT_OWNER')", [DEMO.tenant]));
      const dup = await errorOf(c.query("select public.invite_staff($1, 'staff@apexdrive.demo', 'MANAGER')", [DEMO.tenant]));
      const stored = (await c.query("select invite_token_hash from public.memberships where id = $1", [inv.membership_id])).rows[0].invite_token_hash;

      await c.query("reset role");
      const newUser = (await c.query("insert into auth.users (email) values ('new@apexdrive.demo') returning id")).rows[0].id;
      const other = (await c.query("insert into auth.users (email) values ('other@apexdrive.demo') returning id")).rows[0].id;
      await as(c, other);
      const wrongEmail = await errorOf(c.query("select public.accept_invitation($1)", [inv.token]));
      await as(c, newUser);
      const tenantId = (await c.query("select public.accept_invitation($1) t", [inv.token])).rows[0].t;
      const reuse = await errorOf(c.query("select public.accept_invitation($1)", [inv.token]));
      const perms = (await c.query("select permissions from public.my_memberships()")).rows[0].permissions as string[];
      return { denied, ownerRole, dup, stored, token: inv.token, wrongEmail, tenantId, reuse, perms };
    });
    expect(res.denied).toBe("FORBIDDEN");
    expect(res.ownerRole).toBe("FORBIDDEN");
    expect(res.dup).toBe("ALREADY_MEMBER");
    expect(res.stored).toBe(createHash("sha256").update(res.token).digest("hex"));
    expect(res.wrongEmail).toBe("INVITATION_EMAIL_MISMATCH");
    expect(res.tenantId).toBe(DEMO.tenant);
    expect(res.reuse).toBe("INVITATION_INVALID");
    expect(res.perms).toContain("bookings.cancel");
    expect(res.perms).not.toContain("payments.refund");
  });

  it("suspending staff revokes access immediately", async () => {
    const n = await asActor(pool, { kind: "user", userId: DEMO.owner }, async (c) => {
      const m = (await c.query("select id from public.memberships where user_id = $1", [DEMO.employee])).rows[0].id;
      await c.query("select public.set_membership_status($1, 'SUSPENDED')", [m]);
      await as(c, DEMO.employee);
      return Number((await c.query("select count(*) n from public.bookings")).rows[0].n) + Number((await c.query("select count(*) n from public.vehicles")).rows[0].n);
    });
    expect(n).toBe(0);
  });
});

describe("plan limits", () => {
  it("blocks resources beyond the plan", async () => {
    const err = await asActor(pool, { kind: "service" }, async (c) => {
      await c.query("reset role");
      await c.query("update public.tenant_subscriptions set plan_id = (select id from public.subscription_plans where key = 'starter') where tenant_id = $1", [DEMO.tenant]);
      // starter allows 1 branch; Apex already has 2
      return errorOf(c.query(`insert into public.branches (tenant_id, name, address_line1, city, country_code, timezone) values ($1, 'Third', 'x', 'x', 'AL', 'Europe/Tirane')`, [DEMO.tenant]));
    });
    expect(err).toBe("PLAN_LIMIT_REACHED");
  });

  it("resolves feature flags from plan and overrides", async () => {
    const f = await asActor(pool, { kind: "user", userId: DEMO.owner }, async (c) => (await c.query("select public.tenant_features($1) f", [DEMO.tenant])).rows[0].f);
    expect(f.dynamic_pricing).toBe(true); // business plan
    expect(f.ai_damage_assist).toBe(false);
  });
});

describe("booking modification & post-rental charges", () => {
  it("moves the occupancy block, re-prices, and respects conflicts", async () => {
    const res = await asActor(pool, { kind: "service" }, async (c) => {
      const a = await createBooking(c, bookingPayload({ ...window(300, 2), actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));
      const b = await createBooking(c, bookingPayload({ ...window(310, 2), actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));
      const lines = [{ kind: "BASE", label: "x", quantity: 3, unit_amount_minor: 50000, amount_minor: 150000 }];
      const common = { actor_user_id: DEMO.customerUser, rental_minor: 150000, extras_minor: 0, fees_minor: 0, discount_minor: 0, tax_minor: 0, total_minor: 150000, deposit_minor: 0, due_now_minor: 150000, lines };
      const moved = (await c.query("select public.modify_booking($1) r", [JSON.stringify({ ...common, booking_id: a.id, ...window(300, 3) })])).rows[0].r;
      const clash = await errorOf(c.query("select public.modify_booking($1)", [JSON.stringify({ ...common, booking_id: a.id, ...window(309, 2) })]));
      const total = (await c.query("select total_minor from public.bookings where id = $1", [a.id])).rows[0].total_minor;
      void b;
      return { moved, clash, total };
    });
    expect(res.moved.version).toBeGreaterThan(1);
    expect(res.clash).toBe("VEHICLE_UNAVAILABLE");
    expect(res.total).toBe("150000");
  });
});

describe("agreements, pickup gate and return flow", () => {
  it("runs pickup -> active -> return -> completed with signatures and inspections", async () => {
    const res = await asActor(pool, { kind: "service" }, async (c) => {
      const w = { starts_at: new Date(Date.now() + 3 * 3600_000).toISOString(), ends_at: new Date(Date.now() + 2 * DAY).toISOString() };
      const b = await createBooking(c, bookingPayload({ ...w, vehicle_id: DEMO.teslaS, pickup_branch_id: DEMO.airportBranch, return_branch_id: DEMO.airportBranch, actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));
      await c.query(`insert into public.payments (tenant_id, booking_id, customer_id, purpose, provider, amount_minor, amount_captured_minor, currency, status, idempotency_key)
                     values ($1, $2, $3, 'RENTAL', 'stripe', 100000, 100000, 'EUR', 'SUCCEEDED', gen_random_uuid()::text)`, [DEMO.tenant, b.id, DEMO.customer]);
      await c.query("update public.bookings set amount_paid_minor = 100000, payment_status = 'PAID' where id = $1", [b.id]);
      await c.query(`insert into public.security_deposits (tenant_id, booking_id, amount_minor, currency, status) values ($1, $2, 300000, 'EUR', 'AUTHORIZED')`, [DEMO.tenant, b.id]);
      const hash = createHash("sha256").update("agreement").digest("hex");
      const agr = (await c.query(`insert into public.rental_agreements (tenant_id, booking_id, template_version, content_snapshot, content_sha256) values ($1, $2, 1, '{}', $3) returning id`, [DEMO.tenant, b.id, hash])).rows[0].id;
      const badSig = await errorOf(c.query(`insert into public.signatures (tenant_id, agreement_id, signer_role, signer_name, image_path, signed_content_sha256) values ($1, $2, 'CUSTOMER', 'Sam', 'p', $3)`, [DEMO.tenant, agr, "0".repeat(64)]));

      await as(c, DEMO.employee);
      await c.query("select public.transition_booking($1, 'READY_FOR_PICKUP')", [b.id]);
      const pick = (await c.query(`insert into public.vehicle_inspections (tenant_id, vehicle_id, booking_id, kind, odometer_km, battery_level_pct, performed_by, performed_at, status, customer_accepted_at)
                     values ($1, $2, $3, 'PICKUP', 21000, 85, $4, now(), 'SUBMITTED', now()) returning id`, [DEMO.tenant, DEMO.teslaS, b.id, DEMO.employee])).rows[0].id;
      const noSig = await errorOf(c.query("select public.transition_booking($1, 'ACTIVE')", [b.id]));
      await as(c, null);
      await c.query(`insert into public.signatures (tenant_id, agreement_id, signer_role, signer_name, image_path, signed_content_sha256) values ($1, $2, 'CUSTOMER', 'Sam', 'p', $3), ($1, $2, 'EMPLOYEE', 'Elira', 'p', $3)`, [DEMO.tenant, agr, hash]);
      const agrStatus = (await c.query("select status from public.rental_agreements where id = $1", [agr])).rows[0].status;
      await as(c, DEMO.employee);
      await c.query("select public.transition_booking($1, 'ACTIVE')", [b.id]);
      const vehicleStatus = (await c.query("select status from public.vehicles where id = $1", [DEMO.teslaS])).rows[0].status;
      const early = await errorOf(c.query("select public.transition_booking($1, 'RETURNED')", [b.id]));
      await c.query(`insert into public.vehicle_inspections (tenant_id, vehicle_id, booking_id, kind, odometer_km, battery_level_pct, performed_by, performed_at, status)
                     values ($1, $2, $3, 'RETURN', 21400, 60, $4, now(), 'SUBMITTED')`, [DEMO.tenant, DEMO.teslaS, b.id, DEMO.employee]);
      await c.query("select public.transition_booking($1, 'RETURNED')", [b.id]);
      const empCharge = await errorOf(c.query(`select public.add_post_rental_charges($1, '[{"kind":"FUEL","label":"x","unit_amount_minor":100,"amount_minor":100}]')`, [b.id]));
      await as(c, DEMO.owner);
      const charged = (await c.query(`select public.add_post_rental_charges($1, '[{"kind":"MILEAGE","label":"pricing.line.excessKm","quantity":10,"unit_amount_minor":250,"amount_minor":2500}]') r`, [b.id])).rows[0].r;
      await c.query("select public.transition_booking($1, 'COMPLETED')", [b.id]);
      const final = (await c.query("select status, total_minor from public.bookings where id = $1", [b.id])).rows[0];
      const odo = (await c.query("select odometer_km, status from public.vehicles where id = $1", [DEMO.teslaS])).rows[0];
      await as(c, null);
      const notifs = (await c.query("select event from public.notifications where data ->> 'bookingId' = $1 order by event", [b.id])).rows.map((r) => r.event);
      void pick;
      return { badSig, noSig, agrStatus, vehicleStatus, early, empCharge, charged, final, odo, notifs };
    });
    expect(res.badSig).toBe("SIGNATURE_CONTENT_MISMATCH");
    expect(res.noSig).toBe("AGREEMENT_SIGNATURE_REQUIRED");
    expect(res.agrStatus).toBe("FULLY_SIGNED");
    expect(res.vehicleStatus).toBe("RENTED");
    expect(res.early).toBe("RETURN_INSPECTION_REQUIRED");
    expect(res.empCharge).toBe("FORBIDDEN");
    expect(res.charged.added_minor).toBe(2500);
    expect(res.final).toEqual({ status: "COMPLETED", total_minor: "102500" });
    expect(res.odo).toEqual({ odometer_km: 21400, status: "CLEANING" });
    expect(res.notifs).toEqual(expect.arrayContaining(["booking.confirmed", "pickup.reminder", "return.reminder"]));
  });
});

describe("housekeeping & analytics", () => {
  it("marks overdue rentals and notifies", async () => {
    const res = await asActor(pool, { kind: "service" }, async (c) => {
      const b = await createBooking(c, bookingPayload({ ...window(400), actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));
      await c.query("reset role");
      await c.query("alter table public.bookings disable trigger enforce_booking_rules");
      await c.query("update public.bookings set status = 'ACTIVE', ends_at = now() - interval '1 hour', starts_at = now() - interval '2 days' where id = $1", [b.id]);
      await c.query("alter table public.bookings enable trigger enforce_booking_rules");
      await as(c, null);
      const h = (await c.query("select public.run_housekeeping() r")).rows[0].r;
      const status = (await c.query("select status from public.bookings where id = $1", [b.id])).rows[0].status;
      const n = (await c.query("select count(*)::int n from public.notifications where event = 'rental.overdue' and data ->> 'bookingId' = $1", [b.id])).rows[0].n;
      return { h, status, n };
    });
    expect(res.h.overdue).toBeGreaterThanOrEqual(1);
    expect(res.status).toBe("RETURN_DUE");
    expect(res.n).toBeGreaterThan(0);
  });

  it("computes dashboard metrics for authorised users only", async () => {
    const res = await asActor(pool, { kind: "service" }, async (c) => {
      const w = window(5, 3);
      await createBooking(c, bookingPayload({ ...w, actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));
      const from = w.starts_at.slice(0, 10);
      const to = new Date(Date.parse(w.starts_at) + 10 * DAY).toISOString().slice(0, 10);
      await as(c, DEMO.employee);
      const denied = await errorOf(c.query("select public.tenant_dashboard($1, $2, $3)", [DEMO.tenant, from, to]));
      await as(c, DEMO.owner);
      const d = (await c.query("select public.tenant_dashboard($1, $2, $3) d", [DEMO.tenant, from, to])).rows[0].d;
      await as(c, DEMO.platformAdmin);
      const p = (await c.query("select public.platform_overview() p")).rows[0].p;
      await as(c, DEMO.owner);
      const pDenied = await errorOf(c.query("select public.platform_overview()"));
      return { denied, d, p, pDenied };
    });
    expect(res.denied).toBe("FORBIDDEN");
    expect(res.d.period.revenueMinor).toBeGreaterThanOrEqual(100000);
    expect(res.d.period.bookings).toBeGreaterThanOrEqual(1);
    expect(res.d.period.utilization).toBeGreaterThan(0);
    expect(res.d.series.length).toBe(11);
    expect(res.d.byVehicle.find((v: { vehicleId: string }) => v.vehicleId === DEMO.porsche911).revenueMinor).toBeGreaterThanOrEqual(100000);
    expect(res.p.tenantsByStatus.ACTIVE).toBeGreaterThanOrEqual(1);
    expect(res.pDenied).toBe("FORBIDDEN");
  });

  it("platform admin suspends and reactivates tenants; tenants cannot", async () => {
    const res = await asActor(pool, { kind: "user", userId: DEMO.owner }, async (c) => {
      const self = await errorOf(c.query("select public.admin_set_tenant_status($1, 'ACTIVE')", [DEMO.tenant]));
      await as(c, DEMO.platformAdmin);
      const noReason = await errorOf(c.query("select public.admin_set_tenant_status($1, 'SUSPENDED')", [DEMO.tenant]));
      await c.query("select public.admin_set_tenant_status($1, 'SUSPENDED', 'Unpaid invoice')", [DEMO.tenant]);
      await as(c, null);
      const hidden = (await c.query("select public.resolve_tenant(null, 'apex-drive') r")).rows[0].r;
      await as(c, DEMO.platformAdmin);
      await c.query("select public.admin_set_tenant_status($1, 'ACTIVE')", [DEMO.tenant]);
      const audit = (await c.query("select count(*)::int n from public.audit_logs where resource_type = 'tenants' and actor_kind = 'PLATFORM_ADMIN'")).rows[0].n;
      return { self, noReason, hidden, audit };
    });
    expect(res.self).toBe("FORBIDDEN");
    expect(res.noReason).toBe("VALIDATION_FAILED");
    expect(res.hidden).toBeNull();
    expect(res.audit).toBeGreaterThanOrEqual(2);
  });
});
