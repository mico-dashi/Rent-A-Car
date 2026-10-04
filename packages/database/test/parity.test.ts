import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool } from "@rental/testing";
import { BOOKING_TRANSITIONS, ROLE_PERMISSIONS } from "@rental/domain";
import { BOOKING_STATUSES, PERMISSIONS, PRICE_LINE_KINDS, VEHICLE_CATEGORIES, VEHICLE_STATUSES } from "@rental/types";

let pool: Pool;
beforeAll(() => { pool = createPool(); });
afterAll(() => pool.end());

const enumValues = async (name: string) =>
  (await pool.query("select unnest(enum_range(null::public." + name + "))::text v")).rows.map((r) => r.v as string);

describe("TypeScript <-> database parity", () => {
  it("booking state machine matches", async () => {
    const { rows } = await pool.query("select from_status, to_status from public.booking_status_transitions");
    const db = rows.map((r) => `${r.from_status}>${r.to_status}`).sort();
    const ts = Object.entries(BOOKING_TRANSITIONS).flatMap(([f, tos]) => tos.map((t) => `${f}>${t}`)).sort();
    expect(ts).toEqual(db);
  });

  it("role permissions match", async () => {
    const { rows } = await pool.query("select role::text, permission from public.role_permissions");
    const db = rows.map((r) => `${r.role}:${r.permission}`).sort();
    const ts = Object.entries(ROLE_PERMISSIONS).flatMap(([role, perms]) => perms.map((p) => `${role}:${p}`)).sort();
    expect(ts).toEqual(db);
  });

  it("permission catalogue matches", async () => {
    const { rows } = await pool.query("select key from public.permissions");
    expect([...PERMISSIONS].sort()).toEqual(rows.map((r) => r.key).sort());
  });

  it("enums match", async () => {
    expect(await enumValues("booking_status")).toEqual([...BOOKING_STATUSES]);
    expect(await enumValues("vehicle_status")).toEqual([...VEHICLE_STATUSES]);
    expect(await enumValues("vehicle_category")).toEqual([...VEHICLE_CATEGORIES]);
    expect(await enumValues("price_line_kind")).toEqual([...PRICE_LINE_KINDS]);
  });

  it("every public table has RLS enabled", async () => {
    const { rows } = await pool.query("select tablename from pg_tables where schemaname = 'public' and not rowsecurity");
    expect(rows).toEqual([]);
  });

  it("no SECURITY DEFINER function is missing a pinned search_path", async () => {
    const { rows } = await pool.query(`
      select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'app')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows).toEqual([]);
  });
});
