import type { BookingStatus } from "@rental/types";

/**
 * Booking lifecycle. MUST stay identical to public.booking_status_transitions
 * (migration 0006) — enforced by packages/database/test/parity.test.ts.
 */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  DRAFT: ["QUOTE", "PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CANCELLED"],
  QUOTE: ["PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CANCELLED"],
  PENDING_PAYMENT: ["PENDING_APPROVAL", "CONFIRMED", "CANCELLED"],
  PENDING_APPROVAL: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECK_IN_PENDING", "READY_FOR_PICKUP", "CANCELLED", "NO_SHOW"],
  CHECK_IN_PENDING: ["READY_FOR_PICKUP", "CANCELLED", "NO_SHOW"],
  READY_FOR_PICKUP: ["ACTIVE", "CANCELLED", "NO_SHOW"],
  ACTIVE: ["RETURN_DUE", "RETURNED", "DISPUTED"],
  RETURN_DUE: ["RETURNED", "DISPUTED"],
  RETURNED: ["COMPLETED", "DISPUTED"],
  COMPLETED: ["DISPUTED"],
  CANCELLED: [],
  NO_SHOW: ["DISPUTED"],
  DISPUTED: ["COMPLETED", "CANCELLED"],
};

export const TERMINAL_STATUSES: readonly BookingStatus[] = ["CANCELLED"];

/** Statuses in which the booking holds (or will hold) a vehicle. */
export const OCCUPYING_STATUSES: readonly BookingStatus[] = [
  "PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP", "ACTIVE", "RETURN_DUE",
];

/** Statuses a customer may cancel from (before pickup time). */
export const CUSTOMER_CANCELLABLE: readonly BookingStatus[] = [
  "DRAFT", "QUOTE", "PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP",
];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(public readonly from: BookingStatus, public readonly to: BookingStatus) {
    super(`Invalid booking transition ${from} -> ${to}`);
  }
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export type CustomerBookingTab = "UPCOMING" | "ACTIVE" | "PAST" | "CANCELLED";

export function customerTab(status: BookingStatus): CustomerBookingTab {
  switch (status) {
    case "ACTIVE":
    case "RETURN_DUE":
      return "ACTIVE";
    case "RETURNED":
    case "COMPLETED":
    case "DISPUTED":
      return "PAST";
    case "CANCELLED":
    case "NO_SHOW":
      return "CANCELLED";
    default:
      return "UPCOMING";
  }
}
