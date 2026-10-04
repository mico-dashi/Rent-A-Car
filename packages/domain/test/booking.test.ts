import { describe, expect, it } from "vitest";
import { BOOKING_STATUSES } from "@rental/types";
import { assertTransition, BOOKING_TRANSITIONS, canTransition, customerTab, InvalidTransitionError } from "../src/booking/state-machine";
import { quoteCancellation } from "../src/booking/cancellation";

describe("booking state machine", () => {
  it("defines every status", () => {
    expect(Object.keys(BOOKING_TRANSITIONS).sort()).toEqual([...BOOKING_STATUSES].sort());
  });
  it("allows the happy path", () => {
    const path = ["DRAFT", "PENDING_PAYMENT", "CONFIRMED", "READY_FOR_PICKUP", "ACTIVE", "RETURNED", "COMPLETED"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });
  it("forbids skipping pickup or reviving cancelled bookings", () => {
    expect(canTransition("CONFIRMED", "ACTIVE")).toBe(false);
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("ACTIVE", "CANCELLED")).toBe(false);
    expect(() => assertTransition("COMPLETED", "ACTIVE")).toThrow(InvalidTransitionError);
  });
  it("maps statuses to customer tabs", () => {
    expect(customerTab("CONFIRMED")).toBe("UPCOMING");
    expect(customerTab("RETURN_DUE")).toBe("ACTIVE");
    expect(customerTab("COMPLETED")).toBe("PAST");
    expect(customerTab("NO_SHOW")).toBe("CANCELLED");
  });
});

describe("cancellation", () => {
  const policy = { freeCancellationHours: 48, lateCancellationFeeBps: 5000 };
  const booking = {
    status: "CONFIRMED" as const, startsAt: new Date("2026-10-10T10:00:00Z"),
    totalMinor: 100_000, amountPaidMinor: 100_000, amountRefundedMinor: 0,
  };
  it("is free before the cutoff", () => {
    const q = quoteCancellation(booking, policy, new Date("2026-10-08T09:59:00Z"));
    expect(q).toMatchObject({ allowed: true, feeMinor: 0, refundableMinor: 100_000 });
  });
  it("charges the late fee after the cutoff", () => {
    const q = quoteCancellation(booking, policy, new Date("2026-10-09T10:00:00Z"));
    expect(q).toMatchObject({ allowed: true, feeMinor: 50_000, refundableMinor: 50_000 });
  });
  it("cannot be cancelled by the customer after pickup time", () => {
    expect(quoteCancellation(booking, policy, new Date("2026-10-10T10:00:01Z")).allowed).toBe(false);
    expect(quoteCancellation({ ...booking, status: "ACTIVE" }, policy, new Date("2026-10-01T00:00:00Z")).allowed).toBe(false);
  });
  it("does not charge fees on unpaid holds", () => {
    const q = quoteCancellation({ ...booking, status: "PENDING_PAYMENT", amountPaidMinor: 0 }, policy, new Date("2026-10-09T12:00:00Z"));
    expect(q.feeMinor).toBe(0);
  });
});
