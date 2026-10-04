import type { BookingStatus, CurrencyCode, ExtraBilling, PriceLineKind, VehicleCategory } from "./enums";

/** ISO-8601 UTC timestamp string. */
export type IsoTimestamp = string;
/** Integer amount in the currency's minor unit (e.g. cents). Never a float. */
export type MinorUnits = number;

export interface Money {
  amountMinor: MinorUnits;
  currency: CurrencyCode;
}

export interface PriceLine {
  kind: PriceLineKind;
  /** i18n key, e.g. "pricing.line.base". Rendered by the client in the user's language. */
  label: string;
  labelParams?: Record<string, string | number>;
  quantity: number;
  unitAmountMinor: MinorUnits;
  amountMinor: MinorUnits;
  isTaxable: boolean;
  sourceRuleId?: string;
}

export interface TenantBranding {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  fontHeading: string;
  fontBody: string;
  logoPath: string | null;
  logoDarkPath: string | null;
  appIconPath: string | null;
  splashPath: string | null;
  heroImagePath: string | null;
  headline: string | null;
  subheadline: string | null;
  aboutMd: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  socialLinks: Record<string, string>;
  faq: { q: string; a: string }[];
  hidePlatformBranding: boolean;
  defaultTheme: "dark" | "light" | "system";
}

/** Public storefront configuration returned by the `resolve_tenant` RPC. */
export interface ResolvedTenant {
  id: string;
  slug: string;
  displayName: string;
  countryCode: string;
  currency: CurrencyCode;
  language: string;
  timezone: string;
  bookingMode: "EXACT_VEHICLE" | "VEHICLE_CLASS";
  bufferMinutes: number;
  freeCancellationHours: number;
  lateCancellationFeeBps: number;
  paymentTiming: "FULL_AT_BOOKING" | "PARTIAL_AT_BOOKING" | "PAY_AT_PICKUP";
  fuelPolicy: string;
  minDriverAge: number;
  branding: TenantBranding;
  primaryHostname: string | null;
}

export interface CatalogVehicle {
  id: string;
  tenant_id: string;
  branch_id: string;
  make: string;
  model: string;
  trim: string | null;
  year: number;
  category: VehicleCategory;
  exterior_color: string | null;
  transmission: "MANUAL" | "AUTOMATIC";
  fuel_type: string;
  drivetrain: string | null;
  seats: number;
  doors: number;
  luggage: number | null;
  engine: string | null;
  horsepower: number | null;
  electric_range_km: number | null;
  currency: CurrencyCode;
  daily_rate_minor: number;
  weekly_rate_minor: number | null;
  monthly_rate_minor: number | null;
  hourly_rate_minor: number | null;
  deposit_minor: number;
  minimum_driver_age: number;
  included_km_per_day: number | null;
  extra_km_rate_minor: number;
  description: string | null;
  rating_avg: number;
  rating_count: number;
  created_at: IsoTimestamp;
  features: string[];
  thumbnail_path: string | null;
  class_id: string | null;
}

export interface BookingSummary {
  id: string;
  reference: string;
  status: BookingStatus;
  startsAt: IsoTimestamp;
  endsAt: IsoTimestamp;
  totalMinor: MinorUnits;
  currency: CurrencyCode;
}

export interface ExtraOption {
  id: string;
  code: string;
  name: string;
  kind: "EXTRA" | "INSURANCE";
  billing: ExtraBilling;
  priceMinor: MinorUnits;
  maxPriceMinor: MinorUnits | null;
  maxQuantity: number;
  depositReductionBps: number;
}
