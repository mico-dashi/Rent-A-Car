import { describe, expect, it } from "vitest";
import { computeBaseRate } from "../src/pricing/base-rate";
import { PricingError, quote } from "../src/pricing/engine";
import type { PricingRule, TaxRule } from "../src/pricing/types";
import { sum } from "../src/money";
import { baseInput } from "./fixtures";

const rule = (r: Partial<PricingRule> & Pick<PricingRule, "id" | "kind">): PricingRule => ({
  name: r.kind, isDynamic: false, condition: {}, adjustmentBps: null, amountMinor: null, per: "BOOKING",
  priority: 100, isActive: true, ...r,
});
const vat: TaxRule = { id: "vat", name: "VAT", rateBps: 2000, isInclusive: false, appliesTo: ["RENTAL", "EXTRAS", "FEES"], effectiveFrom: "2020-01-01", effectiveTo: null };

function expectConsistent(q: ReturnType<typeof quote>) {
  expect(sum(q.lines.map((l) => l.amountMinor))).toBe(q.totalMinor);
  expect(q.rentalMinor + q.extrasMinor + q.feesMinor - q.discountMinor + q.taxMinor).toBe(q.totalMinor);
  expect(q.totalMinor).toBeGreaterThanOrEqual(0);
  expect(q.dueNowMinor + q.dueLaterMinor).toBe(q.totalMinor);
  for (const l of q.lines) expect(Number.isInteger(l.amountMinor)).toBe(true);
}

describe("base rate", () => {
  const rates = baseInput().vehicle;
  const at = (days: number, extraMinutes = 0) => ({
    start: new Date("2026-10-01T10:00:00Z"),
    end: new Date(Date.parse("2026-10-01T10:00:00Z") + days * 86_400_000 + extraMinutes * 60_000),
  });

  it("charges daily for short rentals", () => {
    expect(computeBaseRate(at(3), rates, 0).amountMinor).toBe(30_000);
  });
  it("respects the grace period before starting a new day", () => {
    expect(computeBaseRate(at(3, 59), rates, 59).days).toBe(3);
    expect(computeBaseRate(at(3, 60), rates, 59).days).toBe(4);
  });
  it("uses weekly rate and caps leftover days at a week", () => {
    expect(computeBaseRate(at(7), rates, 0).amountMinor).toBe(60_000);
    expect(computeBaseRate(at(13), rates, 0).amountMinor).toBe(120_000); // 60k + min(6*10k, 60k)
    expect(computeBaseRate(at(9), rates, 0).amountMinor).toBe(80_000);
  });
  it("uses monthly rate for 30+ days", () => {
    expect(computeBaseRate(at(30), rates, 0).amountMinor).toBe(200_000);
    expect(computeBaseRate(at(31), rates, 0).amountMinor).toBe(210_000);
  });
  it("never exceeds paying daily", () => {
    const pricey = { ...rates, weeklyRateMinor: 90_000 };
    expect(computeBaseRate(at(7), pricey, 0).amountMinor).toBe(70_000);
  });
  it("uses hourly rate for sub-day rentals when cheaper", () => {
    const hourly = { ...rates, hourlyRateMinor: 2000 };
    const r = computeBaseRate({ start: new Date("2026-10-01T10:00:00Z"), end: new Date("2026-10-01T13:30:00Z") }, hourly, 0);
    expect(r).toMatchObject({ unit: "HOUR", quantity: 4, amountMinor: 8000 });
    const long = computeBaseRate({ start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-01T20:00:00Z") }, hourly, 0);
    expect(long).toMatchObject({ unit: "DAY", amountMinor: 10_000 });
  });
});

describe("quote", () => {
  it("produces an itemised, consistent quote", () => {
    const q = quote(baseInput({ taxRules: [vat] }));
    expect(q.days).toBe(3);
    expect(q.lines.map((l) => l.kind)).toEqual(["BASE", "TAX"]);
    expect(q.totalMinor).toBe(36_000);
    expect(q.includedKm).toBe(750);
    expectConsistent(q);
  });

  it("applies weekend surcharge on local weekend days (branch timezone)", () => {
    // Fri 2026-10-09 23:30 Tirana = 21:30Z. In UTC that's still Friday; locally Friday too.
    // Sat 00:30 Tirana = Fri 22:30Z -> UTC says Friday but local day is Saturday.
    const input = baseInput({
      startsAt: new Date("2026-10-09T22:30:00Z"), // Sat 00:30 local
      endsAt: new Date("2026-10-10T22:30:00Z"),
      rules: [rule({ id: "wk", kind: "WEEKEND_SURCHARGE", condition: { days: [6, 0] }, adjustmentBps: 1000 })],
    });
    const q = quote(input);
    expect(q.lines.find((l) => l.kind === "WEEKEND_SURCHARGE")?.amountMinor).toBe(1000);
    expectConsistent(q);
  });

  it("handles DST transitions without losing or gaining a billable day", () => {
    // Europe DST ends 2026-10-25 03:00 -> 02:00 local
    const q = quote(baseInput({
      startsAt: new Date("2026-10-24T08:00:00Z"),
      endsAt: new Date("2026-10-26T08:00:00Z"),
    }));
    expect(q.days).toBe(2);
    expectConsistent(q);
  });

  it("applies seasonal rates per day, by priority", () => {
    const q = quote(baseInput({
      startsAt: new Date("2026-06-29T08:00:00Z"),
      endsAt: new Date("2026-07-03T08:00:00Z"), // 4 days: Jun 29, 30, Jul 1, 2
      seasonalRates: [
        { id: "s1", name: "Summer", startsOn: "2026-07-01", endsOn: "2026-08-31", adjustmentBps: 2500, category: null, priority: 10 },
        { id: "s2", name: "Other", startsOn: "2026-07-01", endsOn: "2026-07-31", adjustmentBps: 9000, category: null, priority: 50 },
      ],
    }));
    expect(q.lines.find((l) => l.kind === "SEASONAL")?.amountMinor).toBe(5000);
    expectConsistent(q);
  });

  it("applies duration discount, extras, fees, coupon and VAT", () => {
    const q = quote(baseInput({
      startsAt: new Date("2026-10-06T08:00:00Z"),
      endsAt: new Date("2026-10-14T08:00:00Z"), // 8 days
      pickupIsAirport: true,
      oneWayFeeMinor: 3500,
      driverAge: 23,
      additionalDrivers: 1,
      rules: [
        rule({ id: "dur", kind: "DURATION_DISCOUNT", condition: { minDays: 7 }, adjustmentBps: -1000 }),
        rule({ id: "air", kind: "AIRPORT_SURCHARGE", amountMinor: 2500 }),
        rule({ id: "yd", kind: "YOUNG_DRIVER_FEE", condition: { belowAge: 25 }, amountMinor: 2000, per: "DAY" }),
        rule({ id: "ad", kind: "ADDITIONAL_DRIVER_FEE", amountMinor: 1000, per: "DAY" }),
      ],
      extras: [
        { id: "e1", code: "full_cover", name: "Full cover", kind: "INSURANCE", billing: "PER_DAY", priceMinor: 4500, maxPriceMinor: 31_500, quantity: 1, depositReductionBps: 5000 },
        { id: "e2", code: "child_seat", name: "Child seat", kind: "EXTRA", billing: "PER_DAY", priceMinor: 800, maxPriceMinor: null, quantity: 2, depositReductionBps: 0 },
        { id: "e3", code: "gps", name: "GPS", kind: "EXTRA", billing: "FREE", priceMinor: 0, maxPriceMinor: null, quantity: 1, depositReductionBps: 0 },
      ],
      discount: { id: "c1", code: "WELCOME10", percentOffBps: 1000, amountOffMinor: null, minRentalDays: 2 },
      taxRules: [vat],
    }));
    // base: 60k weekly + min(1*10k, 60k) = 70k; -10% duration = -7k; coupon 10% of 63k = -6.3k
    expect(q.lines.find((l) => l.kind === "BASE")?.amountMinor).toBe(70_000);
    expect(q.lines.find((l) => l.kind === "DISCOUNT")?.amountMinor).toBe(-7000);
    expect(q.lines.find((l) => l.kind === "COUPON")?.amountMinor).toBe(-6300);
    expect(q.lines.find((l) => l.kind === "INSURANCE")?.amountMinor).toBe(31_500); // capped
    expect(q.lines.find((l) => l.label === "extra:child_seat")?.amountMinor).toBe(12_800);
    expect(q.lines.find((l) => l.kind === "YOUNG_DRIVER_FEE")?.amountMinor).toBe(16_000);
    expect(q.lines.find((l) => l.kind === "ADDITIONAL_DRIVER")?.amountMinor).toBe(8000);
    expect(q.depositMinor).toBe(50_000);
    expectConsistent(q);
  });

  it("supports tax-inclusive pricing without adding tax to the total", () => {
    const q = quote(baseInput({ taxRules: [{ ...vat, isInclusive: true }] }));
    expect(q.totalMinor).toBe(30_000);
    expect(q.taxMinor).toBe(0);
    expect(q.includedTaxMinor).toBe(5000);
    expectConsistent(q);
  });

  it("only applies tax rules effective at pickup date", () => {
    const q = quote(baseInput({ taxRules: [{ ...vat, effectiveFrom: "2027-01-01" }] }));
    expect(q.taxMinor).toBe(0);
  });

  it("ignores dynamic rules unless enabled, and clamps to floor/ceiling", () => {
    const rules = [
      rule({ id: "lt", kind: "LEAD_TIME", isDynamic: true, condition: { withinHours: 24 }, adjustmentBps: 1000 }),
      rule({ id: "ut", kind: "UTILIZATION", isDynamic: true, condition: { above: 0.8 }, adjustmentBps: 50_000 }),
    ];
    const lastMinute = { now: new Date("2026-10-06T00:00:00Z") };
    expect(quote(baseInput({ ...lastMinute, rules })).lines.some((l) => l.kind === "DYNAMIC_ADJUSTMENT")).toBe(false);

    const q = quote(baseInput({ ...lastMinute, rules, dynamic: { enabled: true, utilization: 0.95, floorBps: 5000, ceilingBps: 15_000 } }));
    const adj = q.lines.find((l) => l.kind === "DYNAMIC_ADJUSTMENT");
    expect(adj?.amountMinor).toBe(15_000); // clamped: 30k * 150% = 45k -> +15k
    expectConsistent(q);
  });

  it("never discounts below zero", () => {
    const q = quote(baseInput({ discount: { id: "d", code: "BIG", percentOffBps: null, amountOffMinor: 9_999_999, minRentalDays: null } }));
    expect(q.totalMinor).toBe(0);
    expectConsistent(q);
  });

  it("rejects coupons below their minimum rental length", () => {
    expect(() => quote(baseInput({ discount: { id: "d", code: "X", percentOffBps: 1000, amountOffMinor: null, minRentalDays: 5 } })))
      .toThrow(PricingError);
  });

  it("computes due-now for partial and pay-at-pickup", () => {
    expect(quote(baseInput({ paymentTiming: "PARTIAL_AT_BOOKING" })).dueNowMinor).toBe(9000);
    const p = quote(baseInput({ paymentTiming: "PAY_AT_PICKUP" }));
    expect(p.dueNowMinor).toBe(0);
    expect(p.dueLaterMinor).toBe(30_000);
  });

  it("is deterministic", () => {
    const input = baseInput({ taxRules: [vat], rules: [rule({ id: "wk", kind: "WEEKEND_SURCHARGE", adjustmentBps: 1000 })] });
    expect(quote(input)).toEqual(quote(input));
  });
});
