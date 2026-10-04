import type { QuoteInput } from "../src/pricing/types";

export function baseInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    currency: "EUR",
    // Tue 2026-10-06 10:00 Tirana (UTC+2) -> Fri 2026-10-09 10:00
    startsAt: new Date("2026-10-06T08:00:00Z"),
    endsAt: new Date("2026-10-09T08:00:00Z"),
    now: new Date("2026-09-27T12:00:00Z"),
    timeZone: "Europe/Tirane",
    vehicle: {
      category: "SPORTS",
      hourlyRateMinor: null,
      dailyRateMinor: 10_000,
      weeklyRateMinor: 60_000,
      monthlyRateMinor: 200_000,
      depositMinor: 100_000,
      includedKmPerDay: 250,
    },
    pickupIsAirport: false,
    oneWayFeeMinor: 0,
    deliveryFeeMinor: 0,
    driverAge: 35,
    additionalDrivers: 0,
    extras: [],
    rules: [],
    seasonalRates: [],
    taxRules: [],
    discount: null,
    dynamic: { enabled: false, utilization: 0, floorBps: 5000, ceilingBps: 20000 },
    graceMinutes: 59,
    paymentTiming: "FULL_AT_BOOKING",
    partialPaymentBps: 3000,
    ...overrides,
  };
}
