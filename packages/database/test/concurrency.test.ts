import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActorCommitted, createPool, DEMO, type Pool } from "@rental/testing";
import { bookingPayload, createBooking, window } from "./helpers";

let pool: Pool;
beforeAll(() => { pool = createPool(30); });
afterAll(() => pool.end());

/**
 * Many customers race for the same last vehicle at the same moment.
 * Each attempt runs in its own connection and transaction and commits.
 */
async function race(n: number, payload: (i: number) => Record<string, unknown>) {
  const results = await Promise.allSettled(
    Array.from({ length: n }, (_, i) =>
      asActorCommitted(pool, { kind: "service" }, (c) => createBooking(c, payload(i)))),
  );
  return {
    ok: results.filter((r) => r.status === "fulfilled").length,
    errors: results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as Error).message),
  };
}

describe("concurrency", () => {
  it("exactly one of 20 simultaneous bookings for the same vehicle succeeds", async () => {
    const w = window(200, 3);
    const { ok, errors } = await race(20, (i) => bookingPayload({ ...w, starts_at: new Date(new Date(w.starts_at).getTime() + i * 60_000).toISOString() }));
    expect(ok).toBe(1);
    expect(new Set(errors)).toEqual(new Set(["VEHICLE_UNAVAILABLE"]));
    const { rows } = await pool.query(
      "select count(*)::int n from public.vehicle_availability_blocks where vehicle_id = $1 and released_at is null and period && tstzrange($2, $3)",
      [DEMO.porsche911, w.starts_at, w.ends_at]);
    expect(rows[0].n).toBe(1);
  });

  it("class capacity holds under contention (2 vehicles, 12 racers)", async () => {
    const w = window(220, 2);
    const { ok, errors } = await race(12, () =>
      bookingPayload({ ...w, vehicle_id: null, vehicle_class_id: DEMO.evClass, actor_user_id: DEMO.owner, initial_status: "CONFIRMED" }));
    expect(ok).toBe(2);
    expect(new Set(errors)).toEqual(new Set(["CLASS_SOLD_OUT"]));
  });

  it("the same idempotency key under contention creates one booking", async () => {
    const payload = bookingPayload(window(240));
    const { ok } = await race(8, () => payload);
    const { rows } = await pool.query("select count(*)::int n from public.bookings where idempotency_key = $1", [payload.idempotency_key]);
    expect(rows[0].n).toBe(1);
    expect(ok).toBeGreaterThanOrEqual(1);
  });
});
