import { BusinessError, httpStatusFor, isBusinessErrorCode, type BusinessErrorCode, type PriceLine } from "@rental/types";

/** Payload accepted by the `public.create_booking(jsonb)` RPC (service role only). */
export interface CreateBookingPayload {
  tenant_id: string;
  actor_user_id: string;
  customer_id: string;
  vehicle_id?: string | null;
  vehicle_class_id?: string | null;
  pickup_branch_id: string;
  return_branch_id: string;
  pickup_type?: "BRANCH" | "AIRPORT" | "HOTEL" | "CUSTOM_ADDRESS";
  delivery_address?: string | null;
  starts_at: string;
  ends_at: string;
  initial_status?: "PENDING_PAYMENT" | "PENDING_APPROVAL" | "CONFIRMED";
  currency: string;
  rental_minor: number;
  extras_minor: number;
  fees_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  deposit_minor: number;
  due_now_minor: number;
  lines: {
    kind: PriceLine["kind"];
    label: string;
    quantity: number;
    unit_amount_minor: number;
    amount_minor: number;
    is_taxable: boolean;
    source_rule_id?: string | null;
  }[];
  extras?: { extra_id: string; quantity: number; unit_price_minor: number; total_minor: number }[];
  pricing_snapshot: Record<string, unknown>;
  discount_code_id?: string | null;
  included_km?: number | null;
  driver_age?: number | null;
  additional_drivers?: number;
  customer_notes?: string | null;
  idempotency_key: string;
}

export interface CreateBookingResult {
  id: string;
  reference: string;
  status: string;
  replayed: boolean;
  hold_expires_at: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Convert engine price lines to the RPC shape (rule ids that are not UUIDs are dropped). */
export function toPayloadLines(lines: readonly PriceLine[]): CreateBookingPayload["lines"] {
  return lines.map((l) => ({
    kind: l.kind,
    label: l.label,
    quantity: l.quantity,
    unit_amount_minor: l.unitAmountMinor,
    amount_minor: l.amountMinor,
    is_taxable: l.isTaxable,
    source_rule_id: l.sourceRuleId && UUID_RE.test(l.sourceRuleId) ? l.sourceRuleId : null,
  }));
}

interface PgLikeError {
  code?: string;
  message?: string;
}

/**
 * Map a PostgreSQL / PostgREST error to a safe BusinessError. Engine errors use
 * SQLSTATE P0001 with a stable code as the message; everything else becomes an
 * opaque INTERNAL_ERROR (details are logged server-side, never returned).
 */
export function toBusinessError(error: unknown): BusinessError {
  const e = error as PgLikeError;
  const message = (e?.message ?? "").trim();
  if (isBusinessErrorCode(message)) {
    return new BusinessError(message, httpStatusFor(message));
  }
  if (e?.code === "42501") return new BusinessError("FORBIDDEN", 403);
  if (e?.code === "23P01") return new BusinessError("VEHICLE_UNAVAILABLE", 409);
  if (e?.code === "40001") return new BusinessError("VERSION_CONFLICT", 409);
  return new BusinessError("INTERNAL_ERROR" satisfies BusinessErrorCode, 500);
}
