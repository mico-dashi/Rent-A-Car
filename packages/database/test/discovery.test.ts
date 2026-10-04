import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, createPool, DEMO, errorOf, type Pool } from "@rental/testing";

let pool: Pool;
beforeAll(() => { pool = createPool(); });
afterAll(() => pool.end());

const TIRANA: [number, number] = [41.33, 19.82];

describe("location discovery", () => {
  it("is off unless enabled, then returns the nearest branch of active tenants within the radius", async () => {
    const res = await asActor(pool, { kind: "anon" }, async (c) => {
      const off = (await c.query("select * from public.nearby_tenants($1, $2)", TIRANA)).rows;
      await c.query("reset role");
      await c.query("update public.feature_flags set enabled = true where key = 'location_discovery' and tenant_id is null");
      await c.query("set local role anon");
      const on = (await c.query("select * from public.nearby_tenants($1, $2)", TIRANA)).rows;
      const far = (await c.query("select * from public.nearby_tenants(48.85, 2.35, 200)")).rows;
      const tight = (await c.query("select * from public.nearby_tenants(41.4147, 19.7206, 1)")).rows; // at the airport branch
      await c.query("reset role");
      await c.query("insert into public.feature_flags (key, tenant_id, enabled) values ('location_discovery', $1, false)", [DEMO.tenant]);
      await c.query("set local role anon");
      const optedOut = (await c.query("select * from public.nearby_tenants($1, $2)", TIRANA)).rows;
      const bad = await errorOf(c.query("select * from public.nearby_tenants(91, 0)"));
      return { off, on, far, tight, optedOut, bad };
    });
    expect(res.off).toEqual([]);
    expect(res.on).toHaveLength(1);
    expect(res.on[0]).toMatchObject({ slug: "apex-drive", branch_name: "City Center", city: "Tirana" });
    expect(Number((res.on[0] as { distance_km: string }).distance_km)).toBeLessThan(1);
    expect(res.far).toEqual([]);
    expect(res.tight[0]).toMatchObject({ branch_name: "Airport" });
    expect(res.optedOut).toEqual([]);
    expect(res.bad).toBe("VALIDATION_FAILED");
  });

  it("never lists suspended tenants", async () => {
    const rows = await asActor(pool, { kind: "anon" }, async (c) => {
      await c.query("reset role");
      await c.query("update public.feature_flags set enabled = true where key = 'location_discovery' and tenant_id is null");
      await c.query("alter table public.tenants disable trigger user");
      await c.query("update public.tenants set status = 'SUSPENDED' where id = $1", [DEMO.tenant]);
      await c.query("alter table public.tenants enable trigger user");
      await c.query("set local role anon");
      return (await c.query("select * from public.nearby_tenants($1, $2)", TIRANA)).rows;
    });
    expect(rows).toEqual([]);
  });
});
