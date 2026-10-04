import { randomUUID } from "node:crypto";
import type { Client } from "@rental/testing";
import { DEMO } from "@rental/testing";

export const DAY = 86_400_000;

/** A future window aligned to the hour, `offsetDays` from now, lasting `days`. */
export function window(offsetDays: number, days = 2, offsetHours = 0) {
  const base = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + offsetDays * DAY + offsetHours * 3_600_000);
  return { starts_at: base.toISOString(), ends_at: new Date(base.getTime() + days * DAY).toISOString() };
}

export function bookingPayload(overrides: Record<string, unknown> = {}) {
  const total = 100_000;
  return {
    tenant_id: DEMO.tenant,
    actor_user_id: DEMO.customerUser,
    customer_id: DEMO.customer,
    vehicle_id: DEMO.porsche911,
    pickup_branch_id: DEMO.cityBranch,
    return_branch_id: DEMO.cityBranch,
    ...window(30),
    currency: "EUR",
    rental_minor: total,
    extras_minor: 0,
    fees_minor: 0,
    discount_minor: 0,
    tax_minor: 0,
    total_minor: total,
    deposit_minor: 300_000,
    due_now_minor: total,
    lines: [{ kind: "BASE", label: "pricing.line.baseDaily", quantity: 2, unit_amount_minor: 50_000, amount_minor: total, is_taxable: true }],
    pricing_snapshot: { engineVersion: "test" },
    idempotency_key: randomUUID(),
    ...overrides,
  };
}

export async function createBooking(c: Client, payload: Record<string, unknown>) {
  const { rows } = await c.query("select public.create_booking($1::jsonb) as r", [JSON.stringify(payload)]);
  return rows[0].r as { id: string; reference: string; status: string; replayed: boolean };
}
