import type { PriceLine } from "@rental/types";
import { assertMinor, times } from "../money";
import { DAY_MS, MINUTE_MS } from "../time";

export interface ReturnInput {
  scheduledEnd: Date;
  actualReturn: Date;
  graceMinutes: number;
  dailyRateMinor: number;
  pickupOdometerKm: number;
  returnOdometerKm: number;
  /** Total included km for the rental; null = unlimited. */
  includedKm: number | null;
  extraKmRateMinor: number;
  fuelPolicy: "FULL_TO_FULL" | "SAME_TO_SAME" | "PREPAID";
  pickupFuelEighths: number | null;
  returnFuelEighths: number | null;
  fuelChargePerEighthMinor: number;
  /** EVs: battery percentage below pickup level that is tolerated. */
  pickupBatteryPct: number | null;
  returnBatteryPct: number | null;
  batteryChargePerPctMinor: number;
  batteryTolerancePct: number;
}

export interface ReturnCharges {
  distanceKm: number;
  excessKm: number;
  lateMinutes: number;
  lines: PriceLine[];
  totalMinor: number;
}

export class ReturnError extends Error {}

/**
 * Proposed post-rental charges. These are PROPOSALS: staff must confirm them
 * before any charge is attempted. Damage is never computed here.
 */
export function computeReturnCharges(input: ReturnInput): ReturnCharges {
  if (input.returnOdometerKm < input.pickupOdometerKm) {
    throw new ReturnError("Return odometer is lower than pickup odometer");
  }
  const distanceKm = input.returnOdometerKm - input.pickupOdometerKm;
  if (distanceKm > 5000 && input.actualReturn.getTime() - input.scheduledEnd.getTime() < DAY_MS * 30) {
    // Physically implausible for typical rentals; force manual review rather than auto-charging.
    throw new ReturnError("Distance exceeds plausibility threshold; verify odometer");
  }
  const lines: PriceLine[] = [];

  const excessKm = input.includedKm === null ? 0 : Math.max(0, distanceKm - input.includedKm);
  if (excessKm > 0 && input.extraKmRateMinor > 0) {
    const amount = times(input.extraKmRateMinor, excessKm);
    lines.push({
      kind: "MILEAGE", label: "pricing.line.excessKm", labelParams: { km: excessKm },
      quantity: excessKm, unitAmountMinor: input.extraKmRateMinor, amountMinor: amount, isTaxable: true,
    });
  }

  if (input.fuelPolicy !== "PREPAID" && input.pickupFuelEighths !== null && input.returnFuelEighths !== null) {
    const target = input.fuelPolicy === "FULL_TO_FULL" ? 8 : input.pickupFuelEighths;
    const deficit = Math.max(0, target - input.returnFuelEighths);
    if (deficit > 0 && input.fuelChargePerEighthMinor > 0) {
      lines.push({
        kind: "FUEL", label: "pricing.line.fuel", labelParams: { eighths: deficit },
        quantity: deficit, unitAmountMinor: input.fuelChargePerEighthMinor,
        amountMinor: times(input.fuelChargePerEighthMinor, deficit), isTaxable: true,
      });
    }
  }

  if (input.pickupBatteryPct !== null && input.returnBatteryPct !== null) {
    const deficit = Math.max(0, input.pickupBatteryPct - input.batteryTolerancePct - input.returnBatteryPct);
    if (deficit > 0 && input.batteryChargePerPctMinor > 0) {
      lines.push({
        kind: "FUEL", label: "pricing.line.battery", labelParams: { pct: deficit },
        quantity: deficit, unitAmountMinor: input.batteryChargePerPctMinor,
        amountMinor: times(input.batteryChargePerPctMinor, deficit), isTaxable: true,
      });
    }
  }

  const lateMs = input.actualReturn.getTime() - input.scheduledEnd.getTime();
  const lateMinutes = Math.max(0, Math.floor(lateMs / MINUTE_MS));
  if (lateMinutes > input.graceMinutes) {
    // One additional day per started 24 hours beyond the grace window.
    const lateDays = Math.ceil((lateMs - input.graceMinutes * MINUTE_MS) / DAY_MS);
    lines.push({
      kind: "LATE_RETURN", label: "pricing.line.lateReturn", labelParams: { days: lateDays },
      quantity: lateDays, unitAmountMinor: input.dailyRateMinor,
      amountMinor: times(input.dailyRateMinor, lateDays), isTaxable: true,
    });
  }

  const totalMinor = lines.reduce((acc, l) => assertMinor(acc + l.amountMinor), 0);
  return { distanceKm, excessKm, lateMinutes, lines, totalMinor };
}
