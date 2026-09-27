import { mulDiv, times } from "../money";
import { billableDays, billableHours, type Interval } from "../time";
import type { VehicleRates } from "./types";

export interface BaseRateResult {
  amountMinor: number;
  days: number;
  unit: "HOUR" | "DAY";
  quantity: number;
  unitAmountMinor: number;
}

/**
 * Cheapest combination of monthly (30d), weekly (7d) and daily rates, never
 * more expensive than paying the daily rate for every day. Rentals shorter than
 * a day use the hourly rate when configured, capped at one day.
 */
export function computeBaseRate(interval: Interval, rates: VehicleRates, graceMinutes: number): BaseRateResult {
  const days = billableDays(interval, graceMinutes);
  const durationMs = interval.end.getTime() - interval.start.getTime();

  if (rates.hourlyRateMinor !== null && durationMs < 24 * 3_600_000) {
    const hours = billableHours(interval);
    const hourly = times(rates.hourlyRateMinor, hours);
    if (hourly < rates.dailyRateMinor) {
      return { amountMinor: hourly, days: 1, unit: "HOUR", quantity: hours, unitAmountMinor: rates.hourlyRateMinor };
    }
  }

  const daily = rates.dailyRateMinor;
  const weekly = rates.weeklyRateMinor;
  const monthly = rates.monthlyRateMinor;

  let remaining = days;
  let total = 0;
  if (monthly !== null && remaining >= 30) {
    const months = Math.floor(remaining / 30);
    total += times(monthly, months);
    remaining -= months * 30;
  }
  if (weekly !== null && remaining >= 7) {
    const weeks = Math.floor(remaining / 7);
    total += times(weekly, weeks);
    remaining -= weeks * 7;
  }
  let tail = times(daily, remaining);
  // Leftover days never cost more than the next tier up.
  if (weekly !== null && remaining > 0) tail = Math.min(tail, weekly);
  if (monthly !== null && remaining > 0 && days >= 30) tail = Math.min(tail, monthly);
  total += tail;

  const amountMinor = Math.min(total, times(daily, days));
  return {
    amountMinor,
    days,
    unit: "DAY",
    quantity: days,
    unitAmountMinor: mulDiv(amountMinor, 1, days),
  };
}
