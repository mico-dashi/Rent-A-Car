import type { BookingStatus } from "@rental/types";
import { applyBps } from "../money";
import { HOUR_MS } from "../time";
import { CUSTOMER_CANCELLABLE } from "./state-machine";

export interface CancellationPolicy {
  freeCancellationHours: number;
  lateCancellationFeeBps: number;
}

export interface CancellationQuote {
  allowed: boolean;
  feeMinor: number;
  refundableMinor: number;
  freeUntil: Date;
}

const FEE_STATUSES: readonly BookingStatus[] = ["CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP", "PENDING_APPROVAL"];

/** Mirrors the fee logic inside public.transition_booking. */
export function quoteCancellation(
  booking: { status: BookingStatus; startsAt: Date; totalMinor: number; amountPaidMinor: number; amountRefundedMinor: number },
  policy: CancellationPolicy,
  now: Date,
): CancellationQuote {
  const freeUntil = new Date(booking.startsAt.getTime() - policy.freeCancellationHours * HOUR_MS);
  const allowed = CUSTOMER_CANCELLABLE.includes(booking.status) && now < booking.startsAt;
  const feeMinor =
    allowed && FEE_STATUSES.includes(booking.status) && now > freeUntil
      ? applyBps(booking.totalMinor, policy.lateCancellationFeeBps) : 0;
  const refundableMinor = Math.max(0, booking.amountPaidMinor - booking.amountRefundedMinor - feeMinor);
  return { allowed, feeMinor, refundableMinor, freeUntil };
}
