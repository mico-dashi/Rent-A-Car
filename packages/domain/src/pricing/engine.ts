import type { PriceLine } from "@rental/types";
import { allocateEvenly, applyBps, assertMinor, clamp, includedTax, sum, times } from "../money";
import { rentalDayDates, type LocalDateParts } from "../time";
import { computeBaseRate } from "./base-rate";
import type { PricingRule, Quote, QuoteInput, SeasonalRate, TaxRule } from "./types";

export const PRICING_ENGINE_VERSION = "2026.09.1";

export class PricingError extends Error {}

function line(
  kind: PriceLine["kind"],
  label: string,
  amountMinor: number,
  opts: Partial<Omit<PriceLine, "kind" | "label" | "amountMinor">> = {},
): PriceLine {
  return {
    kind,
    label,
    quantity: opts.quantity ?? 1,
    unitAmountMinor: opts.unitAmountMinor ?? amountMinor,
    amountMinor: assertMinor(amountMinor),
    isTaxable: opts.isTaxable ?? true,
    ...(opts.labelParams ? { labelParams: opts.labelParams } : {}),
    ...(opts.sourceRuleId ? { sourceRuleId: opts.sourceRuleId } : {}),
  };
}

function inDateRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to; // ISO dates compare lexicographically
}

function activeRules(input: QuoteInput, kind: PricingRule["kind"]): PricingRule[] {
  return input.rules
    .filter((r) => r.isActive && r.kind === kind && (!r.isDynamic || input.dynamic.enabled))
    .filter((r) => !r.condition.categories || r.condition.categories.includes(input.vehicle.category))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function seasonalFor(day: LocalDateParts, rates: SeasonalRate[], input: QuoteInput): SeasonalRate | undefined {
  return rates
    .filter((r) => inDateRange(day.date, r.startsOn, r.endsOn))
    .filter((r) => r.category === null || r.category === input.vehicle.category)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0];
}

function taxRulesAt(rules: TaxRule[], date: string): TaxRule[] {
  return rules
    .filter((t) => t.effectiveFrom <= date && (t.effectiveTo === null || t.effectiveTo > date))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Deterministic, itemised quote. Same input => same output. The caller
 * persists `lines` and the totals as an immutable snapshot on the booking.
 */
export function quote(input: QuoteInput): Quote {
  const interval = { start: input.startsAt, end: input.endsAt };
  const base = computeBaseRate(interval, input.vehicle, input.graceMinutes);
  const days = base.days;
  const dayDates = rentalDayDates(interval, days, input.timeZone);
  const perDayBase = allocateEvenly(base.amountMinor, days);

  const lines: PriceLine[] = [];
  lines.push(
    line("BASE", base.unit === "HOUR" ? "pricing.line.baseHourly" : "pricing.line.baseDaily", base.amountMinor, {
      quantity: base.quantity,
      unitAmountMinor: base.unitAmountMinor,
      labelParams: { count: base.quantity },
    }),
  );

  // --- Per-day calendar adjustments (seasonal, weekend) ----------------------
  let seasonal = 0;
  let seasonalRuleId: string | undefined;
  for (let i = 0; i < days; i++) {
    const rate = seasonalFor(dayDates[i]!, input.seasonalRates, input);
    if (rate) {
      seasonal += applyBps(perDayBase[i]!, rate.adjustmentBps);
      seasonalRuleId ??= rate.id;
    }
  }
  if (seasonal !== 0) {
    lines.push(line("SEASONAL", "pricing.line.seasonal", seasonal, seasonalRuleId ? { sourceRuleId: seasonalRuleId } : {}));
  }

  for (const rule of activeRules(input, "WEEKEND_SURCHARGE")) {
    const weekdays = rule.condition.days ?? [5, 6];
    let amount = 0;
    let count = 0;
    for (let i = 0; i < days; i++) {
      if (weekdays.includes(dayDates[i]!.weekday)) {
        count++;
        amount += rule.adjustmentBps !== null ? applyBps(perDayBase[i]!, rule.adjustmentBps) : (rule.amountMinor ?? 0);
      }
    }
    if (amount !== 0) {
      lines.push(line("WEEKEND_SURCHARGE", "pricing.line.weekend", amount, { sourceRuleId: rule.id, labelParams: { count } }));
    }
  }

  // Holiday ranges modelled as rules with dateRanges (any kind) are handled via seasonal rates.

  const calendarSubtotal = base.amountMinor + seasonal + sum(lines.filter((l) => l.kind === "WEEKEND_SURCHARGE").map((l) => l.amountMinor));

  // --- Duration discount (static) --------------------------------------------
  for (const rule of activeRules(input, "DURATION_DISCOUNT")) {
    if (days >= (rule.condition.minDays ?? Infinity) && rule.adjustmentBps !== null) {
      const amount = -Math.abs(applyBps(calendarSubtotal, rule.adjustmentBps));
      if (amount !== 0) {
        lines.push(line("DISCOUNT", "pricing.line.durationDiscount", amount, { sourceRuleId: rule.id, labelParams: { days } }));
      }
      break; // only the highest-priority duration discount applies
    }
  }

  // --- Dynamic pricing (opt-in), clamped to tenant floor/ceiling -------------
  if (input.dynamic.enabled) {
    let dynamicBps = 0;
    const firedIds: string[] = [];
    const hoursToStart = (input.startsAt.getTime() - input.now.getTime()) / 3_600_000;
    for (const rule of activeRules(input, "LEAD_TIME")) {
      if (hoursToStart >= 0 && hoursToStart <= (rule.condition.withinHours ?? -1) && rule.adjustmentBps !== null) {
        dynamicBps += rule.adjustmentBps;
        firedIds.push(rule.id);
      }
    }
    for (const rule of activeRules(input, "UTILIZATION")) {
      if (input.dynamic.utilization > (rule.condition.above ?? Infinity) && rule.adjustmentBps !== null) {
        dynamicBps += rule.adjustmentBps;
        firedIds.push(rule.id);
      }
    }
    if (dynamicBps !== 0) {
      const rentalSoFar = sum(lines.map((l) => l.amountMinor));
      const floor = applyBps(base.amountMinor, input.dynamic.floorBps);
      const ceiling = applyBps(base.amountMinor, input.dynamic.ceilingBps);
      const target = clamp(rentalSoFar + applyBps(rentalSoFar, dynamicBps), floor, Math.max(floor, ceiling));
      const adjustment = target - rentalSoFar;
      if (adjustment !== 0) {
        lines.push(
          line("DYNAMIC_ADJUSTMENT", "pricing.line.dynamic", adjustment, {
            ...(firedIds[0] ? { sourceRuleId: firedIds[0] } : {}),
          }),
        );
      }
    }
  }

  const rentalLines = [...lines];
  const rentalGross = sum(rentalLines.map((l) => l.amountMinor));
  if (rentalGross < 0) throw new PricingError("Rental subtotal cannot be negative");

  // --- Fees ----------------------------------------------------------------
  const feeLines: PriceLine[] = [];
  if (input.pickupIsAirport) {
    for (const rule of activeRules(input, "AIRPORT_SURCHARGE")) {
      const amount = rule.amountMinor !== null ? (rule.per === "DAY" ? times(rule.amountMinor, days) : rule.amountMinor)
        : applyBps(base.amountMinor, rule.adjustmentBps ?? 0);
      feeLines.push(line("AIRPORT_SURCHARGE", "pricing.line.airport", amount, { sourceRuleId: rule.id }));
      break;
    }
  }
  if (input.oneWayFeeMinor > 0) feeLines.push(line("ONE_WAY_FEE", "pricing.line.oneWay", assertMinor(input.oneWayFeeMinor)));
  if (input.deliveryFeeMinor > 0) feeLines.push(line("DELIVERY", "pricing.line.delivery", assertMinor(input.deliveryFeeMinor)));
  if (input.driverAge !== null) {
    for (const rule of activeRules(input, "YOUNG_DRIVER_FEE")) {
      if (input.driverAge < (rule.condition.belowAge ?? 0) && rule.amountMinor !== null) {
        const amount = rule.per === "DAY" ? times(rule.amountMinor, days) : rule.amountMinor;
        feeLines.push(line("YOUNG_DRIVER_FEE", "pricing.line.youngDriver", amount, {
          sourceRuleId: rule.id, quantity: rule.per === "DAY" ? days : 1, unitAmountMinor: rule.amountMinor,
        }));
        break;
      }
    }
  }
  if (input.additionalDrivers > 0) {
    const rule = activeRules(input, "ADDITIONAL_DRIVER_FEE")[0];
    if (rule?.amountMinor != null) {
      const perDriver = rule.per === "DAY" ? times(rule.amountMinor, days) : rule.amountMinor;
      feeLines.push(line("ADDITIONAL_DRIVER", "pricing.line.additionalDriver", times(perDriver, input.additionalDrivers), {
        sourceRuleId: rule.id, quantity: input.additionalDrivers, unitAmountMinor: perDriver,
        labelParams: { count: input.additionalDrivers },
      }));
    }
  }

  // --- Extras ----------------------------------------------------------------
  const extraLines: PriceLine[] = [];
  for (const extra of [...input.extras].sort((a, b) => a.code.localeCompare(b.code))) {
    if (!Number.isInteger(extra.quantity) || extra.quantity < 1) throw new PricingError(`Invalid quantity for ${extra.code}`);
    let unit: number;
    switch (extra.billing) {
      case "PER_DAY":
        unit = times(extra.priceMinor, days);
        if (extra.maxPriceMinor !== null) unit = Math.min(unit, extra.maxPriceMinor);
        break;
      case "PER_BOOKING":
      case "PER_UNIT":
        unit = extra.priceMinor;
        break;
      case "FREE":
        unit = 0;
        break;
    }
    extraLines.push(
      line(extra.kind === "INSURANCE" ? "INSURANCE" : "EXTRA", `extra:${extra.code}`, times(unit, extra.quantity), {
        quantity: extra.quantity,
        unitAmountMinor: unit,
        sourceRuleId: extra.id,
        labelParams: { name: extra.name },
      }),
    );
  }

  // --- Coupon ----------------------------------------------------------------
  const discountLines: PriceLine[] = [];
  if (input.discount) {
    const d = input.discount;
    if (d.minRentalDays !== null && days < d.minRentalDays) {
      throw new PricingError("DISCOUNT_CODE_INVALID");
    }
    const raw = d.percentOffBps !== null ? applyBps(rentalGross, d.percentOffBps) : (d.amountOffMinor ?? 0);
    const amount = Math.min(raw, rentalGross); // never discount below zero
    if (amount > 0) {
      discountLines.push(line("COUPON", "pricing.line.coupon", -amount, { sourceRuleId: d.id, labelParams: { code: d.code } }));
    }
  }

  // --- Tax -------------------------------------------------------------------
  const taxable = {
    RENTAL: sum([...rentalLines, ...discountLines].filter((l) => l.isTaxable).map((l) => l.amountMinor)),
    FEES: sum(feeLines.filter((l) => l.isTaxable).map((l) => l.amountMinor)),
    EXTRAS: sum(extraLines.filter((l) => l.isTaxable).map((l) => l.amountMinor)),
  };
  const taxLines: PriceLine[] = [];
  let includedTaxMinor = 0;
  const startDate = dayDates[0]!.date;
  for (const rule of taxRulesAt(input.taxRules, startDate)) {
    const basis = sum(rule.appliesTo.map((k) => taxable[k]));
    if (rule.isInclusive) {
      includedTaxMinor += includedTax(basis, rule.rateBps);
    } else {
      const amount = applyBps(basis, rule.rateBps);
      if (amount !== 0) {
        taxLines.push(line("TAX", "pricing.line.tax", amount, {
          isTaxable: false, sourceRuleId: rule.id, labelParams: { name: rule.name, rate: rule.rateBps / 100 },
        }));
      }
    }
  }

  const allLines = [...rentalLines, ...feeLines, ...extraLines, ...discountLines, ...taxLines];
  const totalMinor = sum(allLines.map((l) => l.amountMinor));
  if (totalMinor < 0) throw new PricingError("Total cannot be negative");

  const positive = (ls: PriceLine[]) => sum(ls.filter((l) => l.amountMinor > 0).map((l) => l.amountMinor));
  const negative = (ls: PriceLine[]) => -sum(ls.filter((l) => l.amountMinor < 0).map((l) => l.amountMinor));

  // Deposit: best insurance reduction applies.
  const reductionBps = Math.max(0, ...input.extras.map((e) => e.depositReductionBps));
  const depositMinor = input.vehicle.depositMinor - applyBps(input.vehicle.depositMinor, reductionBps);

  const dueNowMinor =
    input.paymentTiming === "FULL_AT_BOOKING" ? totalMinor
      : input.paymentTiming === "PARTIAL_AT_BOOKING" ? applyBps(totalMinor, input.partialPaymentBps)
        : 0;

  return {
    currency: input.currency,
    days,
    lines: allLines,
    rentalMinor: positive(rentalLines),
    extrasMinor: sum(extraLines.map((l) => l.amountMinor)),
    feesMinor: sum(feeLines.map((l) => l.amountMinor)),
    discountMinor: negative(rentalLines) + negative(discountLines),
    taxMinor: sum(taxLines.map((l) => l.amountMinor)),
    includedTaxMinor,
    totalMinor,
    depositMinor,
    dueNowMinor,
    dueLaterMinor: totalMinor - dueNowMinor,
    includedKm: input.vehicle.includedKmPerDay === null ? null : input.vehicle.includedKmPerDay * days,
    engineVersion: PRICING_ENGINE_VERSION,
  };
}
