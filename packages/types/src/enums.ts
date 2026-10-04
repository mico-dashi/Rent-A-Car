// Mirrors PostgreSQL enums in supabase/migrations/20260927000001_foundation.sql.
// Parity is asserted by packages/database/test/parity.test.ts.

export const TENANT_STATUSES = ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const ROLE_KEYS = ["TENANT_OWNER", "TENANT_ADMIN", "MANAGER", "EMPLOYEE", "DRIVER"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
/** Platform-level role, not a tenant membership role. */
export type PlatformRole = "PLATFORM_SUPER_ADMIN";
export type AppRole = RoleKey | PlatformRole | "CUSTOMER";

export const VEHICLE_STATUSES = [
  "AVAILABLE", "RESERVED", "RENTED", "MAINTENANCE", "CLEANING", "DAMAGED", "INACTIVE", "SOLD",
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_CATEGORIES = [
  "ECONOMY", "COMPACT", "SEDAN", "SUV", "LUXURY", "SPORTS", "CONVERTIBLE", "ELECTRIC", "VAN", "FOUR_BY_FOUR",
] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

export const TRANSMISSIONS = ["MANUAL", "AUTOMATIC"] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const FUEL_TYPES = ["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const BLOCK_KINDS = ["BOOKING", "MAINTENANCE", "CLEANING", "MANUAL", "TRANSFER"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const BOOKING_STATUSES = [
  "DRAFT", "QUOTE", "PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED", "CHECK_IN_PENDING",
  "READY_FOR_PICKUP", "ACTIVE", "RETURN_DUE", "RETURNED", "COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_MODES = ["EXACT_VEHICLE", "VEHICLE_CLASS"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const PICKUP_TYPES = ["BRANCH", "AIRPORT", "HOTEL", "CUSTOM_ADDRESS"] as const;
export type PickupType = (typeof PICKUP_TYPES)[number];

export const PRICE_LINE_KINDS = [
  "BASE", "WEEKEND_SURCHARGE", "SEASONAL", "AIRPORT_SURCHARGE", "DELIVERY", "ONE_WAY_FEE",
  "YOUNG_DRIVER_FEE", "ADDITIONAL_DRIVER", "INSURANCE", "EXTRA", "MILEAGE", "LATE_RETURN",
  "DYNAMIC_ADJUSTMENT", "DISCOUNT", "COUPON", "TAX", "FUEL", "DAMAGE", "OTHER",
] as const;
export type PriceLineKind = (typeof PRICE_LINE_KINDS)[number];

export const EXTRA_BILLINGS = ["PER_DAY", "PER_BOOKING", "PER_UNIT", "FREE"] as const;
export type ExtraBilling = (typeof EXTRA_BILLINGS)[number];

export const DAMAGE_STATUSES = [
  "REPORTED", "REVIEWING", "CUSTOMER_RESPONSIBLE", "COMPANY_RESPONSIBLE", "INSURANCE",
  "REPAIR_SCHEDULED", "REPAIRED", "CLOSED",
] as const;
export type DamageStatus = (typeof DAMAGE_STATUSES)[number];

export const CURRENCIES = ["EUR", "USD", "GBP", "ALL", "CHF"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const LANGUAGES = ["en", "sq"] as const;
export type LanguageCode = (typeof LANGUAGES)[number];

export const PAYMENT_TIMINGS = ["FULL_AT_BOOKING", "PARTIAL_AT_BOOKING", "PAY_AT_PICKUP"] as const;
export type PaymentTiming = (typeof PAYMENT_TIMINGS)[number];
