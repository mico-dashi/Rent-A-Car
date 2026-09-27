import type { CurrencyCode, ExtraBilling, PaymentTiming, PriceLine, VehicleCategory } from "@rental/types";

export type PricingRuleKind =
  | "WEEKEND_SURCHARGE"
  | "AIRPORT_SURCHARGE"
  | "DURATION_DISCOUNT"
  | "LEAD_TIME"
  | "UTILIZATION"
  | "YOUNG_DRIVER_FEE"
  | "ADDITIONAL_DRIVER_FEE"
  | "DELIVERY_FLAT"
  | "DELIVERY_PER_KM"
  | "LATE_RETURN";

export interface PricingRule {
  id: string;
  name: string;
  kind: PricingRuleKind;
  isDynamic: boolean;
  /** Kind-specific condition, validated by @rental/validation pricingRuleSchema. */
  condition: {
    days?: number[]; // weekdays 0-6 for WEEKEND_SURCHARGE
    minDays?: number; // DURATION_DISCOUNT
    withinHours?: number; // LEAD_TIME
    above?: number; // UTILIZATION (0..1)
    belowAge?: number; // YOUNG_DRIVER_FEE
    categories?: VehicleCategory[];
    dateRanges?: { from: string; to: string }[]; // holiday ranges (YYYY-MM-DD, inclusive)
  };
  adjustmentBps: number | null;
  amountMinor: number | null;
  per: "BOOKING" | "DAY" | "KM" | "HOUR";
  priority: number;
  isActive: boolean;
}

export interface SeasonalRate {
  id: string;
  name: string;
  startsOn: string; // YYYY-MM-DD inclusive
  endsOn: string; // YYYY-MM-DD inclusive
  adjustmentBps: number;
  category: VehicleCategory | null;
  priority: number;
}

export interface TaxRule {
  id: string;
  name: string;
  rateBps: number;
  isInclusive: boolean;
  appliesTo: ("RENTAL" | "EXTRAS" | "FEES")[];
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface SelectedExtra {
  id: string;
  code: string;
  name: string;
  kind: "EXTRA" | "INSURANCE";
  billing: ExtraBilling;
  priceMinor: number;
  maxPriceMinor: number | null;
  quantity: number;
  depositReductionBps: number;
}

export interface DiscountInput {
  id: string;
  code: string;
  percentOffBps: number | null;
  amountOffMinor: number | null;
  minRentalDays: number | null;
}

export interface VehicleRates {
  category: VehicleCategory;
  hourlyRateMinor: number | null;
  dailyRateMinor: number;
  weeklyRateMinor: number | null;
  monthlyRateMinor: number | null;
  depositMinor: number;
  includedKmPerDay: number | null;
}

export interface QuoteInput {
  currency: CurrencyCode;
  startsAt: Date;
  endsAt: Date;
  /** Evaluation time (injected for determinism). */
  now: Date;
  /** Pickup branch timezone (IANA). */
  timeZone: string;
  vehicle: VehicleRates;
  pickupIsAirport: boolean;
  oneWayFeeMinor: number;
  deliveryFeeMinor: number;
  driverAge: number | null;
  additionalDrivers: number;
  extras: SelectedExtra[];
  rules: PricingRule[];
  seasonalRates: SeasonalRate[];
  taxRules: TaxRule[];
  discount: DiscountInput | null;
  dynamic: {
    enabled: boolean;
    /** Current fleet utilization 0..1 for the requested window. */
    utilization: number;
    /** Min allowed rental subtotal as bps of base (5000 = 50%). */
    floorBps: number;
    /** Max allowed rental subtotal as bps of base (20000 = 200%). */
    ceilingBps: number;
  };
  graceMinutes: number;
  paymentTiming: PaymentTiming;
  partialPaymentBps: number;
}

export interface Quote {
  currency: CurrencyCode;
  days: number;
  lines: PriceLine[];
  rentalMinor: number;
  extrasMinor: number;
  feesMinor: number;
  discountMinor: number;
  taxMinor: number;
  /** Tax already contained in tax-inclusive prices (informational; not added). */
  includedTaxMinor: number;
  totalMinor: number;
  depositMinor: number;
  dueNowMinor: number;
  dueLaterMinor: number;
  includedKm: number | null;
  /** Engine version + inputs digest stored on the booking for auditability. */
  engineVersion: string;
}
