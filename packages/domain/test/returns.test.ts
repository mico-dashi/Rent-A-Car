import { describe, expect, it } from "vitest";
import { computeReturnCharges, ReturnError, type ReturnInput } from "../src/pricing/return-charges";

const input = (o: Partial<ReturnInput> = {}): ReturnInput => ({
  scheduledEnd: new Date("2026-10-09T10:00:00Z"),
  actualReturn: new Date("2026-10-09T10:30:00Z"),
  graceMinutes: 59,
  dailyRateMinor: 10_000,
  pickupOdometerKm: 10_000,
  returnOdometerKm: 10_700,
  includedKm: 750,
  extraKmRateMinor: 250,
  fuelPolicy: "FULL_TO_FULL",
  pickupFuelEighths: 8,
  returnFuelEighths: 8,
  fuelChargePerEighthMinor: 1500,
  pickupBatteryPct: null,
  returnBatteryPct: null,
  batteryChargePerPctMinor: 0,
  batteryTolerancePct: 5,
  ...o,
});

describe("return charges", () => {
  it("charges nothing for a clean on-time return", () => {
    expect(computeReturnCharges(input()).totalMinor).toBe(0);
  });
  it("charges excess mileage, fuel deficit and late days", () => {
    const r = computeReturnCharges(input({
      returnOdometerKm: 10_800, returnFuelEighths: 5, actualReturn: new Date("2026-10-09T12:00:00Z"),
    }));
    expect(r.excessKm).toBe(50);
    expect(r.lines.map((l) => [l.kind, l.amountMinor])).toEqual([
      ["MILEAGE", 12_500], ["FUEL", 4500], ["LATE_RETURN", 10_000],
    ]);
  });
  it("treats unlimited mileage as unlimited", () => {
    expect(computeReturnCharges(input({ includedKm: null, returnOdometerKm: 12_000 })).totalMinor).toBe(0);
  });
  it("rejects impossible odometer readings", () => {
    expect(() => computeReturnCharges(input({ returnOdometerKm: 9_999 }))).toThrow(ReturnError);
    expect(() => computeReturnCharges(input({ returnOdometerKm: 20_000 }))).toThrow(ReturnError);
  });
  it("charges EV battery deficit beyond tolerance", () => {
    const r = computeReturnCharges(input({ pickupFuelEighths: null, returnFuelEighths: null, pickupBatteryPct: 90, returnBatteryPct: 70, batteryChargePerPctMinor: 100 }));
    expect(r.totalMinor).toBe(1500);
  });
});
