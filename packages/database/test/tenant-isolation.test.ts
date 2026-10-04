import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, createPool, DEMO, errorOf, type Pool } from "@rental/testing";
import { ensureRivalTenant, RIVAL } from "./setup-rival";

let pool: Pool;
beforeAll(async () => {
  pool = createPool();
  await ensureRivalTenant(pool);
});
afterAll(() => pool.end());

const owner = { kind: "user", userId: DEMO.owner } as const;
const count = async (c: import("@rental/testing").Client, sql: string, params: unknown[] = []) =>
  Number((await c.query(sql, params)).rows[0].n);

describe("tenant isolation (Tenant A = Apex, Tenant B = Rival)", () => {
  // Private tables. ensureRivalTenant puts at least one row in each, so these assertions are not vacuous.
  const privateTables = [
    "vehicles", "customers", "driver_licenses", "bookings", "booking_price_lines", "payments", "pricing_rules",
    "discount_codes", "tenant_settings", "memberships", "vehicle_availability_blocks", "maintenance_records",
    "audit_logs", "vehicle_damages", "expenses", "vehicle_documents", "customer_notes",
  ];

  it("rival tenant has data in every private table (sanity)", async () => {
    for (const table of privateTables) {
      const { rows } = await pool.query(`select count(*)::int n from public.${table} where tenant_id = $1`, [RIVAL.tenant]);
      expect(rows[0].n, table).toBeGreaterThan(0);
    }
  });

  for (const table of privateTables) {
    it(`Tenant A owner cannot read Tenant B ${table}`, async () => {
      const n = await asActor(pool, owner, (c) => count(c, `select count(*) n from public.${table} where tenant_id = $1`, [RIVAL.tenant]));
      expect(n).toBe(0);
    });
  }

  it("public storefront data (branches, extras, tax rules) is readable by anyone but writable only by its tenant", async () => {
    const res = await asActor(pool, owner, async (c) => ({
      read: await count(c, "select count(*) n from public.branches where tenant_id = $1", [RIVAL.tenant]),
      write: (await c.query("update public.branches set name = 'pwned' where tenant_id = $1", [RIVAL.tenant])).rowCount,
    }));
    expect(res).toEqual({ read: 1, write: 0 });
  });

  it("Tenant A owner sees its own data", async () => {
    const n = await asActor(pool, owner, (c) => count(c, "select count(*) n from public.vehicles where tenant_id = $1", [DEMO.tenant]));
    expect(n).toBe(8);
  });

  it("Tenant A owner cannot insert rows into Tenant B", async () => {
    const err = await asActor(pool, owner, (c) =>
      errorOf(c.query(
        `insert into public.branches (tenant_id, name, address_line1, city, country_code, timezone)
         values ($1, 'Hijack', 'x', 'x', 'GB', 'UTC')`, [RIVAL.tenant])));
    expect(err).toMatch(/row-level security/);
  });

  it("Tenant A owner cannot update or delete Tenant B rows (0 rows affected)", async () => {
    const res = await asActor(pool, owner, async (c) => {
      const u = await c.query("update public.vehicles set daily_rate_minor = 1 where id = $1", [RIVAL.vehicle]);
      const d = await c.query("delete from public.customers where id = $1", [RIVAL.customer]);
      return [u.rowCount, d.rowCount];
    });
    expect(res).toEqual([0, 0]);
  });

  it("cannot move a row to another tenant", async () => {
    const err = await asActor(pool, owner, (c) =>
      errorOf(c.query("update public.branches set tenant_id = $1 where id = $2", [RIVAL.tenant, DEMO.cityBranch])));
    expect(err).not.toBeNull();
  });

  it("cannot reference another tenant's rows through foreign keys", async () => {
    const err = await asActor(pool, owner, (c) =>
      errorOf(c.query(
        `insert into public.vehicles (tenant_id, branch_id, fleet_number, registration_plate, make, model, year, category,
          transmission, fuel_type, seats, doors, currency, daily_rate_minor)
         values ($1, $2, 'X', 'X', 'X', 'X', 2024, 'SPORTS', 'AUTOMATIC', 'PETROL', 2, 2, 'EUR', 1)`,
        [DEMO.tenant, RIVAL.branch])));
    expect(err).toMatch(/foreign key/);
  });

  it("Tenant B customer cannot see Tenant A bookings or customers", async () => {
    const n = await asActor(pool, { kind: "user", userId: RIVAL.customerUser }, async (c) =>
      (await count(c, "select count(*) n from public.bookings where tenant_id = $1", [DEMO.tenant])) + (await count(c, "select count(*) n from public.customers where tenant_id = $1", [DEMO.tenant])));
    expect(n).toBe(0);
  });

  it("anon cannot read the vehicles base table (VIN / purchase price)", async () => {
    const n = await asActor(pool, { kind: "anon" }, (c) => count(c, "select count(*) n from public.vehicles"));
    expect(n).toBe(0);
  });

  it("public catalogue exposes no sensitive columns", async () => {
    const cols = await asActor(pool, { kind: "anon" }, async (c) =>
      (await c.query("select * from public.catalog_vehicles limit 1")).fields.map((f) => f.name));
    for (const secret of ["vin", "purchase_price_minor", "estimated_value_minor", "registration_plate", "qr_token"]) {
      expect(cols).not.toContain(secret);
    }
  });

  it("suspended tenants disappear from the public catalogue and become read-only for staff", async () => {
    const result = await asActor(pool, { kind: "service" }, async (c) => {
      await c.query("update public.tenants set status = 'SUSPENDED' where id = $1", [RIVAL.tenant]);
      await c.query("reset role");
      await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await c.query("set local role anon");
      const catalogue = await count(c, "select count(*) n from public.catalog_vehicles where tenant_id = $1", [RIVAL.tenant]);
      await c.query("reset role");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: RIVAL.owner, role: "authenticated" })]);
      await c.query("set local role authenticated");
      const canRead = await count(c, "select count(*) n from public.vehicles where tenant_id = $1", [RIVAL.tenant]);
      const upd = await c.query("update public.vehicles set daily_rate_minor = 1 where id = $1", [RIVAL.vehicle]);
      return { catalogue, canRead, updated: upd.rowCount };
    });
    expect(result).toEqual({ catalogue: 0, canRead: 1, updated: 0 });
  });
});
