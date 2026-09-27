import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, createPool, DEMO, errorOf, type Client, type Pool } from "@rental/testing";
import { bookingPayload, createBooking, DAY, window } from "./helpers";

let pool: Pool;
beforeAll(() => { pool = createPool(); });
afterAll(() => pool.end());

const service = { kind: "service" } as const;
const asUser = async (c: Client, userId: string) => {
  await c.query("reset role");
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await c.query("set local role authenticated");
};
const asService = async (c: Client) => {
  await c.query("reset role");
  await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await c.query("set local role service_role");
};

describe("booking engine", () => {
  it("creates a held booking with price lines and a buffered occupancy block", async () => {
    const res = await asActor(pool, service, async (c) => {
      const p = bookingPayload();
      const b = await createBooking(c, p);
      const block = (await c.query("select lower(period) s, upper(period) e, hold_expires_at from public.vehicle_availability_blocks where booking_id = $1", [b.id])).rows[0];
      const lines = (await c.query("select sum(amount_minor)::int t from public.booking_price_lines where booking_id = $1", [b.id])).rows[0].t;
      const history = (await c.query("select to_status from public.booking_status_history where booking_id = $1 order by id", [b.id])).rows.map((r) => r.to_status);
      return { b, block, lines, p, history };
    });
    expect(res.b.status).toBe("PENDING_PAYMENT");
    expect(res.lines).toBe(100_000);
    expect(new Date(res.block.e).getTime() - new Date(res.p.ends_at).getTime()).toBe(60 * 60_000); // 60-min buffer
    expect(res.block.hold_expires_at).not.toBeNull();
    expect(res.history).toEqual(["DRAFT", "PENDING_PAYMENT"]);
  });

  it("rejects overlapping bookings, including inside the turnaround buffer", async () => {
    const errs = await asActor(pool, service, async (c) => {
      const w = window(40, 2);
      await createBooking(c, bookingPayload(w));
      const overlap = await errorOf(createBooking(c, bookingPayload(window(41, 2))));
      const inBuffer = await errorOf(createBooking(c, bookingPayload({
        starts_at: new Date(new Date(w.ends_at).getTime() + 30 * 60_000).toISOString(),
        ends_at: new Date(new Date(w.ends_at).getTime() + 2 * DAY).toISOString(),
      })));
      const afterBuffer = await errorOf(createBooking(c, bookingPayload({
        starts_at: new Date(new Date(w.ends_at).getTime() + 60 * 60_000).toISOString(),
        ends_at: new Date(new Date(w.ends_at).getTime() + 2 * DAY).toISOString(),
      })));
      return { overlap, inBuffer, afterBuffer };
    });
    expect(errs.overlap).toBe("VEHICLE_UNAVAILABLE");
    expect(errs.inBuffer).toBe("VEHICLE_UNAVAILABLE");
    expect(errs.afterBuffer).toBeNull();
  });

  it("is idempotent on the idempotency key", async () => {
    const [a, b] = await asActor(pool, service, async (c) => {
      const p = bookingPayload(window(50));
      return [await createBooking(c, p), await createBooking(c, p)];
    });
    expect(b!.id).toBe(a!.id);
    expect(b!.replayed).toBe(true);
  });

  it("validates money invariants and ownership", async () => {
    const errs = await asActor(pool, service, async (c) => ({
      mismatch: await errorOf(createBooking(c, bookingPayload({ ...window(60), total_minor: 1 }))),
      currency: await errorOf(createBooking(c, bookingPayload({ ...window(61), currency: "USD" }))),
      stranger: await errorOf(createBooking(c, bookingPayload({ ...window(62), actor_user_id: DEMO.owner.replace(/2$/, "9") }))),
      leadTime: await errorOf(createBooking(c, bookingPayload({ starts_at: new Date(Date.now() + 60_000).toISOString(), ends_at: new Date(Date.now() + 2 * DAY).toISOString() }))),
      wrongBranch: await errorOf(createBooking(c, bookingPayload({ ...window(63), pickup_branch_id: DEMO.airportBranch }))),
      skipPayment: await errorOf(createBooking(c, bookingPayload({ ...window(64), initial_status: "CONFIRMED" }))),
    }));
    expect(errs).toEqual({
      mismatch: "PRICE_LINES_MISMATCH", currency: "CURRENCY_MISMATCH", stranger: "FORBIDDEN",
      leadTime: "LEAD_TIME_NOT_MET", wrongBranch: "VEHICLE_NOT_AT_BRANCH", skipPayment: "PAYMENT_REQUIRED",
    });
  });

  it("maintenance blocks availability and search", async () => {
    const res = await asActor(pool, service, async (c) => {
      const { rows } = await c.query(
        "select lower(period) s, upper(period) e from public.vehicle_availability_blocks where vehicle_id = $1 and kind = 'MAINTENANCE' and released_at is null",
        [DEMO.bmwM4]);
      const s = new Date(rows[0].s);
      const w = { starts_at: new Date(s.getTime() - DAY).toISOString(), ends_at: new Date(s.getTime() + DAY).toISOString() };
      const err = await errorOf(createBooking(c, bookingPayload({ ...w, vehicle_id: DEMO.bmwM4 })));
      const found = (await c.query("select id from public.search_available_vehicles($1, $2, $3, $4)", [DEMO.tenant, w.starts_at, w.ends_at, DEMO.cityBranch])).rows.map((r) => r.id);
      return { err, found };
    });
    expect(res.err).toBe("VEHICLE_UNAVAILABLE");
    expect(res.found).not.toContain(DEMO.bmwM4);
    expect(res.found).toContain(DEMO.porsche911);
  });

  it("maintenance cannot be scheduled over a confirmed booking", async () => {
    const err = await asActor(pool, service, async (c) => {
      const w = window(70, 3);
      await createBooking(c, bookingPayload(w));
      return errorOf(c.query(
        `insert into public.maintenance_records (tenant_id, vehicle_id, type, scheduled_start, scheduled_end) values ($1, $2, 'OIL', $3, $4)`,
        [DEMO.tenant, DEMO.porsche911, new Date(new Date(w.starts_at).getTime() + DAY).toISOString(), w.ends_at]));
    });
    expect(err).toMatch(/vehicle_blocks_no_overlap/);
  });

  it("expired holds release the vehicle and cancel the unpaid booking", async () => {
    const res = await asActor(pool, service, async (c) => {
      const w = window(80);
      const first = await createBooking(c, bookingPayload(w));
      await c.query("update public.vehicle_availability_blocks set hold_expires_at = now() - interval '1 minute' where booking_id = $1", [first.id]);
      const second = await createBooking(c, bookingPayload(w));
      const firstStatus = (await c.query("select status, cancellation_reason from public.bookings where id = $1", [first.id])).rows[0];
      return { second, firstStatus };
    });
    expect(res.second.status).toBe("PENDING_PAYMENT");
    expect(res.firstStatus).toEqual({ status: "CANCELLED", cancellation_reason: "HOLD_EXPIRED" });
  });

  it("confirms on payment and enforces the state machine & pickup gates", async () => {
    const res = await asActor(pool, service, async (c) => {
      const b = await createBooking(c, bookingPayload(window(90)));
      const pay = (await c.query(
        `insert into public.payments (tenant_id, booking_id, customer_id, purpose, provider, amount_minor, amount_captured_minor, currency, status, idempotency_key)
         values ($1, $2, $3, 'RENTAL', 'stripe', 100000, 100000, 'EUR', 'SUCCEEDED', gen_random_uuid()::text) returning id`,
        [DEMO.tenant, b.id, DEMO.customer])).rows[0].id;
      const confirmed = (await c.query("select public.record_booking_payment($1, 100000, $2) r", [b.id, pay])).rows[0].r;
      const hold = (await c.query("select hold_expires_at from public.vehicle_availability_blocks where booking_id = $1", [b.id])).rows[0].hold_expires_at;

      await asUser(c, DEMO.employee);
      const skip = await errorOf(c.query("select public.transition_booking($1, 'ACTIVE')", [b.id]));
      await c.query("select public.transition_booking($1, 'READY_FOR_PICKUP')", [b.id]);
      const gate = await errorOf(c.query("select public.transition_booking($1, 'ACTIVE')", [b.id]));
      const customerCantConfirm = await (async () => { await asUser(c, DEMO.customerUser); return errorOf(c.query("select public.transition_booking($1, 'NO_SHOW')", [b.id])); })();
      const paid = (await c.query("select payment_status, amount_paid_minor from public.bookings where id = $1", [b.id])).rows[0];
      return { confirmed, hold, skip, gate, customerCantConfirm, paid };
    });
    expect(res.confirmed.status).toBe("CONFIRMED");
    expect(res.hold).toBeNull();
    expect(res.skip).toBe("INVALID_TRANSITION");
    expect(res.gate).toBe("PICKUP_INSPECTION_REQUIRED");
    expect(res.customerCantConfirm).toBe("FORBIDDEN");
    expect(res.paid).toEqual({ payment_status: "PAID", amount_paid_minor: "100000" });
  });

  it("price snapshot is immutable after confirmation", async () => {
    const err = await asActor(pool, service, async (c) => {
      const b = await createBooking(c, bookingPayload({ ...window(95), actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));
      await c.query("reset role");
      return errorOf(c.query("update public.bookings set total_minor = 1, rental_minor = 1, due_now_minor = 0 where id = $1", [b.id]));
    });
    expect(err).toMatch(/immutable/);
  });

  it("customer cancellation: free early, fee late, releases the vehicle", async () => {
    const res = await asActor(pool, service, async (c) => {
      const early = await createBooking(c, bookingPayload({ ...window(100), actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));
      const late = await createBooking(c, bookingPayload({ ...window(1, 2), vehicle_id: DEMO.teslaS, pickup_branch_id: DEMO.airportBranch, return_branch_id: DEMO.airportBranch, actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));
      await asUser(c, DEMO.customerUser);
      const e = (await c.query("select public.transition_booking($1, 'CANCELLED', 'changed plans') r", [early.id])).rows[0].r;
      const l = (await c.query("select public.transition_booking($1, 'CANCELLED', 'changed plans') r", [late.id])).rows[0].r;
      await asService(c);
      const released = (await c.query("select count(*)::int n from public.vehicle_availability_blocks where booking_id in ($1, $2) and released_at is null", [early.id, late.id])).rows[0].n;
      return { e, l, released };
    });
    expect(res.e.cancellation_fee_minor).toBe(0);
    expect(res.l.cancellation_fee_minor).toBe(50_000); // 50% late fee
    expect(res.released).toBe(0);
  });

  it("class bookings respect class capacity and substitution rules", async () => {
    const res = await asActor(pool, service, async (c) => {
      const w = window(120, 2);
      const cls = { vehicle_id: null, vehicle_class_id: DEMO.evClass, actor_user_id: DEMO.owner, initial_status: "CONFIRMED", ...w };
      const a = await createBooking(c, bookingPayload(cls));
      const b = await createBooking(c, bookingPayload(cls));
      const third = await errorOf(createBooking(c, bookingPayload(cls)));
      const exact = await errorOf(createBooking(c, bookingPayload({ ...w, vehicle_id: DEMO.taycan, actor_user_id: DEMO.owner, initial_status: "CONFIRMED" })));
      await asUser(c, DEMO.owner);
      const wrongClass = await errorOf(c.query("select public.assign_booking_vehicle($1, $2)", [a.id, DEMO.porsche911]));
      await c.query("select public.assign_booking_vehicle($1, $2)", [a.id, DEMO.taycan]);
      const clash = await errorOf(c.query("select public.assign_booking_vehicle($1, $2)", [b.id, DEMO.taycan]));
      await c.query("select public.assign_booking_vehicle($1, $2)", [b.id, DEMO.teslaS]);
      return { third, exact, wrongClass, clash };
    });
    expect(res.third).toBe("CLASS_SOLD_OUT");
    expect(res.exact).toBe("CLASS_SOLD_OUT");
    expect(res.wrongClass).toBe("SUBSTITUTION_NOT_ALLOWED");
    expect(res.clash).toBe("VEHICLE_UNAVAILABLE");
  });

  it("onboarding creates a complete tenant atomically", async () => {
    const res = await asActor(pool, { kind: "user", userId: DEMO.customerUser }, async (c) => {
      const id = (await c.query("select public.create_tenant('sam-cars', 'Sam Cars', 'Sam Cars Ltd', 'GB', 'GBP', 'en', 'Europe/London') id")).rows[0].id;
      const t = (await c.query("select status from public.tenants where id = $1", [id])).rows[0];
      const m = (await c.query("select role from public.memberships where tenant_id = $1", [id])).rows[0];
      const d = (await c.query("select hostname from public.tenant_domains where tenant_id = $1", [id])).rows[0];
      const s = (await c.query("select status from public.tenant_subscriptions where tenant_id = $1", [id])).rows[0];
      return { t, m, d, s };
    });
    expect(res).toEqual({
      t: { status: "PENDING_APPROVAL" }, m: { role: "TENANT_OWNER" }, d: { hostname: "sam-cars.localhost" }, s: { status: "TRIALING" },
    });
  });

  it("resolves tenants by hostname, slug and code — only when active", async () => {
    const res = await asActor(pool, { kind: "anon" }, async (c) => ({
      host: (await c.query("select public.resolve_tenant('APEX-DRIVE.localhost') r")).rows[0].r?.slug,
      slug: (await c.query("select public.resolve_tenant(null, 'apex-drive') r")).rows[0].r?.id,
      code: (await c.query("select public.resolve_tenant(null, null, 'apex01') r")).rows[0].r?.slug,
      none: (await c.query("select public.resolve_tenant('unknown.example.com') r")).rows[0].r,
    }));
    expect(res).toEqual({ host: "apex-drive", slug: DEMO.tenant, code: "apex-drive", none: null });
  });
});
