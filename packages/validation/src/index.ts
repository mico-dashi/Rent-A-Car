import { z } from "zod";
import { CURRENCIES, EXTRA_BILLINGS, LANGUAGES, PICKUP_TYPES, VEHICLE_CATEGORIES } from "@rental/types";

export const uuid = z.string().uuid();
export const isoTimestamp = z.string().datetime({ offset: true });
export const minorUnits = z.number().int().nonnegative().max(1_000_000_000_00);
export const currencyCode = z.enum(CURRENCIES);
export const languageCode = z.enum(LANGUAGES);
export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "3–48 lowercase letters, digits or dashes");
export const countryCode = z.string().regex(/^[A-Z]{2}$/);
export const hostname = z.string().toLowerCase().regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/);

const rentalWindow = z
  .object({ startsAt: isoTimestamp, endsAt: isoTimestamp })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: "Return must be after pickup", path: ["endsAt"] });

export const searchSchema = z
  .object({
    tenantId: uuid,
    pickupBranchId: uuid,
    returnBranchId: uuid,
    startsAt: isoTimestamp,
    endsAt: isoTimestamp,
    category: z.enum(VEHICLE_CATEGORIES).optional(),
    transmission: z.enum(["MANUAL", "AUTOMATIC"]).optional(),
    minSeats: z.coerce.number().int().min(1).max(60).optional(),
    maxPriceMinor: z.coerce.number().int().nonnegative().optional(),
    electricOnly: z.coerce.boolean().optional(),
    sort: z.enum(["recommended", "price_asc", "price_desc", "newest", "rating"]).default("recommended"),
    page: z.coerce.number().int().min(0).default(0),
  })
  .and(rentalWindow);
export type SearchInput = z.infer<typeof searchSchema>;

export const quoteRequestSchema = z
  .object({
    tenantId: uuid,
    vehicleId: uuid.optional(),
    vehicleClassId: uuid.optional(),
    pickupBranchId: uuid,
    returnBranchId: uuid,
    startsAt: isoTimestamp,
    endsAt: isoTimestamp,
    pickupType: z.enum(PICKUP_TYPES).default("BRANCH"),
    deliveryAddress: z.string().trim().min(5).max(300).optional(),
    driverDateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    additionalDrivers: z.number().int().min(0).max(5).default(0),
    extras: z.array(z.object({ extraId: uuid, quantity: z.number().int().min(1).max(20) })).max(20).default([]),
    discountCode: z.string().trim().max(40).optional(),
  })
  .and(rentalWindow)
  .refine((v) => Boolean(v.vehicleId) !== Boolean(v.vehicleClassId), { message: "Choose a vehicle or a class" })
  .refine((v) => (v.pickupType === "HOTEL" || v.pickupType === "CUSTOM_ADDRESS" ? Boolean(v.deliveryAddress) : true), {
    message: "Delivery address required",
    path: ["deliveryAddress"],
  });
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const createBookingRequestSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    acceptedTermsVersion: z.string().min(1),
    customerNotes: z.string().max(1000).optional(),
  })
  .and(quoteRequestSchema);
export type CreateBookingRequest = z.infer<typeof createBookingRequestSchema>;

export const tenantOnboardingStep1 = z.object({
  displayName: z.string().trim().min(2).max(80),
  legalName: z.string().trim().min(2).max(160),
  slug,
  countryCode,
  currency: currencyCode,
  language: languageCode,
  timezone: z.string().min(3).max(64),
});

export const brandingSchema = z.object({
  primaryColor: hexColor,
  secondaryColor: hexColor,
  backgroundColor: hexColor,
  fontHeading: z.string().max(60),
  fontBody: z.string().max(60),
  headline: z.string().max(120).nullable(),
  subheadline: z.string().max(240).nullable(),
  contactEmail: z.string().email().nullable(),
  contactPhone: z.string().max(40).nullable(),
});

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  addressLine1: z.string().trim().min(3).max(160),
  city: z.string().trim().min(2).max(80),
  countryCode,
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  phone: z.string().max(40).nullable(),
  email: z.string().email().nullable(),
  timezone: z.string().min(3),
  airportCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  pickupInstructions: z.string().max(1000).nullable(),
});

export const vehicleSchema = z.object({
  branchId: uuid,
  fleetNumber: z.string().trim().min(1).max(20),
  vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{11,17}$/).nullable(),
  registrationPlate: z.string().trim().min(2).max(20),
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(60),
  trim: z.string().max(60).nullable(),
  year: z.number().int().min(1950).max(2100),
  category: z.enum(VEHICLE_CATEGORIES),
  transmission: z.enum(["MANUAL", "AUTOMATIC"]),
  fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"]),
  seats: z.number().int().min(1).max(60),
  doors: z.number().int().min(0).max(8),
  dailyRateMinor: minorUnits,
  weeklyRateMinor: minorUnits.nullable(),
  monthlyRateMinor: minorUnits.nullable(),
  depositMinor: minorUnits,
  minimumDriverAge: z.number().int().min(16).max(99),
  includedKmPerDay: z.number().int().min(0).nullable(),
  extraKmRateMinor: minorUnits,
});

export const pricingRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("WEEKEND_SURCHARGE"), condition: z.object({ days: z.array(z.number().int().min(0).max(6)).min(1) }), adjustmentBps: z.number().int().min(-9000).max(50000) }),
  z.object({ kind: z.literal("DURATION_DISCOUNT"), condition: z.object({ minDays: z.number().int().min(1) }), adjustmentBps: z.number().int().min(-9000).max(0) }),
  z.object({ kind: z.literal("LEAD_TIME"), condition: z.object({ withinHours: z.number().int().min(1).max(720) }), adjustmentBps: z.number().int().min(-9000).max(50000) }),
  z.object({ kind: z.literal("UTILIZATION"), condition: z.object({ above: z.number().min(0).max(1) }), adjustmentBps: z.number().int().min(-9000).max(50000) }),
  z.object({ kind: z.literal("YOUNG_DRIVER_FEE"), condition: z.object({ belowAge: z.number().int().min(16).max(99) }), amountMinor: minorUnits }),
  z.object({ kind: z.literal("ADDITIONAL_DRIVER_FEE"), condition: z.object({}).default({}), amountMinor: minorUnits }),
  z.object({ kind: z.literal("AIRPORT_SURCHARGE"), condition: z.object({}).default({}), amountMinor: minorUnits }),
]);

export const extraSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(80),
  kind: z.enum(["EXTRA", "INSURANCE"]),
  billing: z.enum(EXTRA_BILLINGS),
  priceMinor: minorUnits,
  maxPriceMinor: minorUnits.nullable(),
  maxQuantity: z.number().int().min(1).max(20),
});

export const taxRuleSchema = z.object({
  name: z.string().min(1).max(40),
  rateBps: z.number().int().min(0).max(10000),
  isInclusive: z.boolean(),
  jurisdictionLabel: z.string().max(80).nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const inspectionSchema = z.object({
  id: uuid, // client-generated for offline creation
  bookingId: uuid.nullable(),
  vehicleId: uuid,
  kind: z.enum(["PICKUP", "RETURN", "ROUTINE"]),
  odometerKm: z.number().int().min(0).max(2_000_000),
  fuelLevelEighths: z.number().int().min(0).max(8).nullable(),
  batteryLevelPct: z.number().int().min(0).max(100).nullable(),
  notes: z.string().max(4000).nullable(),
  performedAt: isoTimestamp,
  version: z.number().int().min(1),
});

export { z };
