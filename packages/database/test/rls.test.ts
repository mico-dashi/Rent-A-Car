import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, createPool, DEMO, errorOf, type Pool } from "@rental/testing";
import { bookingPayload, createBooking } from "./helpers";

let pool: Pool;
beforeAll(() => { pool = createPool(); });
afterAll(() => pool.end());

const employee = { kind: "user", userId: DEMO.employee } as const;
const customer = { kind: "user", userId: DEMO.customerUser } as const;
const owner = { kind: "user", userId: DEMO.owner } as const;

describe("RLS & column guards", () => {
  it("customers cannot write bookings directly", async () => {
    const err = await asActor(pool, customer, (c) =>
      errorOf(c.query("update public.bookings set total_minor = 0 where customer_id = $1", [DEMO.customer])));
    expect(err).toMatch(/permission denied/);
  });

  it("customers cannot call the service-only booking RPC", async () => {
    const err = await asActor(pool, customer, (c) => errorOf(createBooking(c, bookingPayload())));
    expect(err).toMatch(/permission denied/);
  });

  it("customers only see their own bookings", async () => {
    const seen = await asActor(pool, { kind: "service" }, async (c) => {
      await createBooking(c, bookingPayload());
      await c.query("reset role");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: DEMO.employee, role: "authenticated" })]);
      await c.query("set local role authenticated");
      const staff = (await c.query("select count(*) n from public.bookings")).rows[0].n;
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: "00000000-0000-4000-8000-00000000dead", role: "authenticated" })]);
      const stranger = (await c.query("select count(*) n from public.bookings")).rows[0].n;
      return { staff: Number(staff), stranger: Number(stranger) };
    });
    expect(seen.staff).toBeGreaterThan(0);
    expect(seen.stranger).toBe(0);
  });

  it("customers cannot self-verify identity or licences, or lift restrictions", async () => {
    const errs = await asActor(pool, customer, async (c) => [
      await errorOf(c.query("update public.customers set identity_status = 'VERIFIED' where id = $1", [DEMO.customer])),
      await errorOf(c.query("update public.customers set is_restricted = true where id = $1", [DEMO.customer])),
      await errorOf(c.query(
        `insert into public.driver_licenses (tenant_id, customer_id, license_number, issuing_country, expires_on, verification_status)
         values ($1, $2, 'X', 'GB', '2030-01-01', 'VERIFIED')`, [DEMO.tenant, DEMO.customer])),
    ]);
    expect(errs[0]).toMatch(/staff\/provider-managed/);
    expect(errs[1]).toMatch(/customer_restrictions/);
    expect(errs[2]).toMatch(/row-level security/);
  });

  it("employees may change vehicle status but not prices", async () => {
    const res = await asActor(pool, employee, async (c) => ({
      status: (await c.query("update public.vehicles set status = 'CLEANING' where id = $1", [DEMO.porsche911])).rowCount,
      price: await errorOf(c.query("update public.vehicles set daily_rate_minor = 1 where id = $1", [DEMO.porsche911])),
    }));
    expect(res.status).toBe(1);
    expect(res.price).toMatch(/operational field/);
  });

  it("employees cannot manage staff; admins cannot create owners or peers", async () => {
    const empErr = await asActor(pool, employee, (c) =>
      errorOf(c.query(`insert into public.memberships (tenant_id, invited_email, role) values ($1, 'x@y.z', 'MANAGER')`, [DEMO.tenant])));
    expect(empErr).toMatch(/row-level security|at or above/);

    const ownerRes = await asActor(pool, owner, async (c) => ({
      owner: await errorOf(c.query(`insert into public.memberships (tenant_id, invited_email, role) values ($1, 'a@b.c', 'TENANT_OWNER')`, [DEMO.tenant])),
      admin: await errorOf(c.query(`insert into public.memberships (tenant_id, invited_email, role) values ($1, 'a@b.c', 'TENANT_ADMIN')`, [DEMO.tenant])),
      activeBypass: await errorOf(c.query(`insert into public.memberships (tenant_id, user_id, role, status) values ($1, $2, 'MANAGER', 'ACTIVE')`, [DEMO.tenant, DEMO.customerUser])),
    }));
    expect(ownerRes.owner).toMatch(/at or above/);
    expect(ownerRes.admin).toBeNull(); // owner may invite admins
    expect(ownerRes.activeBypass).toMatch(/accept an invitation/);
  });

  it("tenants cannot change their own status, slug, or self-verify domains", async () => {
    const errs = await asActor(pool, owner, async (c) => [
      await errorOf(c.query("update public.tenants set status = 'ACTIVE', slug = 'x' where id = $1", [DEMO.tenant])),
      await errorOf(c.query(`insert into public.tenant_domains (tenant_id, hostname, status) values ($1, 'evil.com', 'VERIFIED')`, [DEMO.tenant])),
      await errorOf(c.query(`insert into public.tenant_domains (tenant_id, hostname) values ($1, 'apexdrive-rentals.com')`, [DEMO.tenant])),
    ]);
    expect(errs[0]).toMatch(/platform/);
    expect(errs[1]).toMatch(/verified by the platform/);
    expect(errs[2]).toBeNull();
  });

  it("audit logs are readable by owners, invisible to employees, immutable to everyone", async () => {
    const res = await asActor(pool, owner, async (c) => ({
      n: Number((await c.query("select count(*) n from public.audit_logs where tenant_id = $1", [DEMO.tenant])).rows[0].n),
      upd: await errorOf(c.query("update public.audit_logs set action = 'x'")),
    }));
    expect(res.n).toBeGreaterThan(0);
    expect(res.upd).toMatch(/permission denied/);
    const empN = await asActor(pool, employee, async (c) => Number((await c.query("select count(*) n from public.audit_logs")).rows[0].n));
    expect(empN).toBe(0);
    const ownerDbErr = await errorOf(pool.query("delete from public.audit_logs"));
    expect(ownerDbErr).toMatch(/append-only/);
  });

  it("audit log redacts PII on customer changes", async () => {
    const after = await asActor(pool, owner, async (c) => {
      await c.query("update public.customers set phone = '+1 555 0100' where id = $1", [DEMO.customer]);
      return (await c.query(
        "select after_state from public.audit_logs where resource_type = 'customers' and resource_id = $1 order by id desc limit 1",
        [DEMO.customer])).rows[0].after_state;
    });
    expect(after.phone).toBe("[redacted]");
    expect(JSON.stringify(after)).not.toContain("555");
  });

  it("refunds can never exceed the captured amount", async () => {
    const err = await asActor(pool, { kind: "service" }, async (c) => {
      const b = await createBooking(c, bookingPayload());
      const { rows } = await c.query(
        `insert into public.payments (tenant_id, booking_id, customer_id, purpose, provider, amount_minor, amount_captured_minor, currency, status, idempotency_key)
         values ($1, $2, $3, 'RENTAL', 'stripe', 100000, 100000, 'EUR', 'SUCCEEDED', gen_random_uuid()::text) returning id`,
        [DEMO.tenant, b.id, DEMO.customer]);
      await c.query(`insert into public.refunds (tenant_id, payment_id, amount_minor, currency, reason, idempotency_key)
                     values ($1, $2, 60000, 'EUR', 'partial', 'r1')`, [DEMO.tenant, rows[0].id]);
      return errorOf(c.query(`insert into public.refunds (tenant_id, payment_id, amount_minor, currency, reason, idempotency_key)
                              values ($1, $2, 50000, 'EUR', 'too much', 'r2')`, [DEMO.tenant, rows[0].id]));
    });
    expect(err).toMatch(/Refund exceeds captured amount/);
  });

  it("duplicate webhook events are rejected", async () => {
    const err = await asActor(pool, { kind: "service" }, async (c) => {
      const ins = `insert into public.webhook_events (provider, event_id, event_type, payload, signature_verified) values ('stripe', 'evt_1', 'x', '{}', true)`;
      await c.query(ins);
      return errorOf(c.query(ins));
    });
    expect(err).toMatch(/duplicate key/);
  });

  it("damage charges require a human decision; AI assessments cannot mark customer responsibility", async () => {
    const err = await asActor(pool, { kind: "service" }, (c) =>
      errorOf(c.query(`insert into public.vehicle_damages (tenant_id, vehicle_id, damage_type, description, status)
                       values ($1, $2, 'SCRATCH', 'x', 'CUSTOMER_RESPONSIBLE')`, [DEMO.tenant, DEMO.porsche911])));
    expect(err).toMatch(/check constraint/);
    const empErr = await asActor(pool, employee, (c) =>
      errorOf(c.query(`insert into public.vehicle_damages (tenant_id, vehicle_id, damage_type, description, status)
                       values ($1, $2, 'SCRATCH', 'x', 'CUSTOMER_RESPONSIBLE')`, [DEMO.tenant, DEMO.porsche911])));
    expect(empErr).toMatch(/row-level security/);
  });

  it("damage payments require an approver", async () => {
    const err = await asActor(pool, { kind: "service" }, (c) =>
      errorOf(c.query(`insert into public.payments (tenant_id, purpose, provider, amount_minor, currency, idempotency_key)
                       values ($1, 'DAMAGE', 'stripe', 5000, 'EUR', 'd1')`, [DEMO.tenant])));
    expect(err).toMatch(/check constraint/);
  });

  it("offline inspection sync rejects stale versions", async () => {
    const err = await asActor(pool, employee, async (c) => {
      const { rows } = await c.query(
        `insert into public.vehicle_inspections (tenant_id, vehicle_id, kind, odometer_km, performed_by, performed_at)
         values ($1, $2, 'ROUTINE', 8300, $3, now()) returning id, version`, [DEMO.tenant, DEMO.porsche911, DEMO.employee]);
      await c.query("update public.vehicle_inspections set notes = 'a', version = 1 where id = $1", [rows[0].id]);
      return errorOf(c.query("update public.vehicle_inspections set notes = 'b', version = 1 where id = $1", [rows[0].id]));
    });
    expect(err).toMatch(/version conflict/);
  });

  it("odometer can never go backwards on inspection submission", async () => {
    const err = await asActor(pool, employee, (c) =>
      errorOf(c.query(`insert into public.vehicle_inspections (tenant_id, vehicle_id, kind, odometer_km, performed_by, performed_at, status)
                       values ($1, $2, 'ROUTINE', 100, $3, now(), 'SUBMITTED')`, [DEMO.tenant, DEMO.porsche911, DEMO.employee])));
    expect(err).toMatch(/Odometer/);
  });

  it("reviews require a completed booking by the reviewer", async () => {
    const err = await asActor(pool, { kind: "service" }, async (c) => {
      const b = await createBooking(c, bookingPayload());
      await c.query("reset role");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: DEMO.customerUser, role: "authenticated" })]);
      await c.query("set local role authenticated");
      return errorOf(c.query(
        `insert into public.reviews (tenant_id, booking_id, vehicle_id, customer_id, author_user_id, rating_car, rating_cleanliness, rating_service, rating_pickup, rating_value)
         values ($1, $2, $3, $4, $5, 5, 5, 5, 5, 5)`, [DEMO.tenant, b.id, DEMO.porsche911, DEMO.customer, DEMO.customerUser]));
    });
    expect(err).toMatch(/completed bookings/);
  });
});
