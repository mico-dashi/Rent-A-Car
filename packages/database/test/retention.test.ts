import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, createPool, DEMO, errorOf, type Client, type Pool } from "@rental/testing";
import { bookingPayload, createBooking, window } from "./helpers";

let pool: Pool;
beforeAll(() => { pool = createPool(); });
afterAll(() => pool.end());

const asService = async (c: Client) => {
  await c.query("reset role");
  await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await c.query("set local role service_role");
};

async function oldCustomer(c: Client, email: string, ageDays: number): Promise<string> {
  const { rows } = await c.query(
    `insert into public.customers (tenant_id, first_name, last_name, email, phone, city, created_at)
     values ($1, 'Ana', 'Hoxha', $2, '+355690000001', 'Tirana', now() - make_interval(days => $3)) returning id`,
    [DEMO.tenant, email, ageDays]);
  return rows[0].id;
}

describe("data retention", () => {
  it("anonymises inactive settled customers past the tenant's period, deletes their documents and messages, and returns the files", async () => {
    const res = await asActor(pool, { kind: "service" }, async (c) => {
      await c.query("reset role");
      await c.query("update public.tenant_settings set data_retention_days = 365 where tenant_id = $1", [DEMO.tenant]);
      const stale = await oldCustomer(c, "stale@example.demo", 400);
      const recent = await oldCustomer(c, "recent@example.demo", 100);
      const busy = await oldCustomer(c, "busy@example.demo", 400);
      await c.query(`insert into public.driver_licenses (tenant_id, customer_id, license_number, issuing_country, expires_on, front_image_path, back_image_path)
                     values ($1, $2, 'AL123', 'AL', '2030-01-01', $3, $4)`, [DEMO.tenant, stale, `${DEMO.tenant}/lic/front.jpg`, `${DEMO.tenant}/lic/back.jpg`]);
      const thread = (await c.query("insert into public.message_threads (tenant_id, customer_id, subject) values ($1, $2, 'Hi') returning id", [DEMO.tenant, stale])).rows[0].id;
      await c.query("insert into public.messages (tenant_id, thread_id, sender_kind, body, attachment_paths) values ($1, $2, 'CUSTOMER', 'my passport', $3)",
        [DEMO.tenant, thread, [`${DEMO.tenant}/msg/passport.jpg`]]);
      // "busy" still has a confirmed upcoming rental: must be kept.
      await asService(c);
      await createBooking(c, bookingPayload({ ...window(30, 2), customer_id: busy, actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));

      await asService(c);
      const r = (await c.query("select public.apply_data_retention() r")).rows[0].r;
      await c.query("reset role");
      const rows = (await c.query("select id, first_name, email, phone, anonymized_at from public.customers where id = any($1)", [[stale, recent, busy]])).rows;
      const left = (await c.query(`select (select count(*) from public.driver_licenses where customer_id = $1)::int lic,
                                          (select count(*) from public.message_threads where customer_id = $1)::int threads,
                                          (select count(*) from public.messages where thread_id = $2)::int msgs`, [stale, thread])).rows[0];
      const again = await (async () => { await asService(c); return (await c.query("select public.apply_data_retention() r")).rows[0].r; })();
      return { r, rows, left, again, stale, recent, busy };
    });
    type Row = { id: string; first_name: string; email: string; phone: string | null; anonymized_at: string | null };
    const byId = new Map((res.rows as Row[]).map((x) => [x.id, x]));
    expect(byId.get(res.stale)).toMatchObject({ first_name: "Deleted", phone: null, email: `deleted+${res.stale}@invalid.example` });
    expect(byId.get(res.stale)?.anonymized_at).not.toBeNull();
    expect(byId.get(res.recent)).toMatchObject({ first_name: "Ana", anonymized_at: null });
    expect(byId.get(res.busy)).toMatchObject({ first_name: "Ana", anonymized_at: null });
    expect(res.left).toEqual({ lic: 0, threads: 0, msgs: 0 });
    expect(res.r.customers).toBeGreaterThanOrEqual(1);
    expect(res.r.files).toEqual(expect.arrayContaining([
      { bucket: "customer-documents", path: `${DEMO.tenant}/lic/front.jpg` },
      { bucket: "customer-documents", path: `${DEMO.tenant}/lic/back.jpg` },
      { bucket: "message-attachments", path: `${DEMO.tenant}/msg/passport.jpg` },
    ]));
    // Idempotent: an anonymised customer is not processed twice.
    expect(res.again.files).not.toEqual(expect.arrayContaining([{ bucket: "customer-documents", path: `${DEMO.tenant}/lic/front.jpg` }]));
  });

  it("is service-only", async () => {
    const err = await asActor(pool, { kind: "user", userId: DEMO.owner }, (c) => errorOf(c.query("select public.apply_data_retention()")));
    expect(err).toMatch(/permission denied|FORBIDDEN/);
  });
});
