import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_ERROR_CODES } from "@rental/types";
import { en } from "../src/messages/en";
import { sq } from "../src/messages/sq";

const ADMIN_SRC = join(__dirname, "../../../apps/admin/src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

function has(catalog: object, key: string): boolean {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || (!!node && typeof node === "object" && "other" in node);
}

const sources = files(ADMIN_SRC).map((f) => readFileSync(f, "utf8"));
const staticKeys = [...new Set(sources.flatMap((s) => [...s.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]!)))];

// Every `t(`prefix.${x}`)` in the admin app, with the values `x` can take.
const DYNAMIC: Record<string, readonly string[]> = {
  "admin.nav": ["overview", "today", "bookings", "calendar", "fleet", "customers", "branches", "pricing", "extras", "maintenance", "damages", "expenses", "employees", "payments", "reports", "messages", "reviews", "website", "branding", "settings", "audit"],
  "admin.roles": ["TENANT_OWNER", "TENANT_ADMIN", "MANAGER", "EMPLOYEE", "DRIVER", "PLATFORM_ADMIN"],
  "admin.tenantStatus": ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "ARCHIVED"],
  "admin.tenantStatusHelp": ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "ARCHIVED"],
  "admin.platform.to": ["ACTIVE", "SUSPENDED", "ARCHIVED"],
  "admin.platform.nav": ["overview", "tenants", "plans", "catalog", "system", "privacy", "audit"],
  "admin.platform.commission": ["NONE", "PERCENTAGE", "FIXED", "CUSTOM"],
  "admin.transitions": ["CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP", "ACTIVE", "RETURN_DUE", "RETURNED", "COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED", "PENDING_PAYMENT", "PENDING_APPROVAL"],
  "admin.agreement": ["GENERATED", "CUSTOMER_SIGNED", "FULLY_SIGNED", "VOID"],
  "admin.invoiceKind": ["INVOICE", "RECEIPT", "CREDIT_NOTE"],
  "admin.deposit": ["NOT_REQUIRED", "PENDING", "METHOD_SAVED", "AUTHORIZED", "PARTIALLY_CAPTURED", "CAPTURED", "RELEASED", "FAILED"],
  "admin.paymentStatus": ["UNPAID", "PARTIALLY_PAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"],
  "admin.payments.purposes": ["RENTAL", "DEPOSIT", "LATE_FEE", "DAMAGE", "OTHER"],
  "admin.payments.statuses": ["REQUIRES_PAYMENT", "PROCESSING", "AUTHORIZED", "SUCCEEDED", "FAILED", "CANCELLED"],
  "admin.assignReason": ["CLASS_ASSIGNMENT", "SUBSTITUTION", "UPGRADE"],
  "admin.bookingMode": ["EXACT_VEHICLE", "VEHICLE_CLASS"],
  "admin.pickupType": ["BRANCH", "AIRPORT", "HOTEL", "CUSTOM_ADDRESS"],
  "admin.vehicleStatus": ["AVAILABLE", "RESERVED", "RENTED", "MAINTENANCE", "CLEANING", "DAMAGED", "INACTIVE", "SOLD"],
  "admin.verification": ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"],
  "admin.verification.action": ["VERIFIED", "REJECTED"],
  "admin.verification.set": ["VERIFIED", "REJECTED", "PENDING"],
  "admin.customers.fields": ["address", "city", "country", "emergencyName", "emergencyPhone", "language", "marketing", "nationality", "phone", "postalCode"],
  "admin.customers.docKinds": ["LICENSE_FRONT", "LICENSE_BACK", "PASSPORT", "NATIONAL_ID", "PROOF_OF_ADDRESS", "OTHER"],
  "admin.customers.restrictActions": ["RESTRICT", "BLACKLIST", "LIFT"],
  "admin.fleet.fields": ["branch", "category", "dailyRate", "deposit", "description", "doors", "drivetrain", "engine", "estimatedValue", "exteriorColor", "extraKm", "fleetNumber", "fuel", "horsepower", "hourlyRate", "includedKm", "includedKmHint", "interiorColor", "luggage", "make", "minAge", "model", "monthlyRate", "odometer", "plate", "published", "purchasePrice", "range", "rates", "seats", "transmission", "trim", "weeklyRate", "year"],
  "admin.fleet.docKinds": ["REGISTRATION", "INSURANCE", "INSPECTION", "OWNERSHIP", "LEASE", "SERVICE_RECORD", "OTHER"],
  "admin.fleet.transferStatus": ["SCHEDULED", "IN_TRANSIT", "COMPLETED", "CANCELLED"],
  "admin.inspections.kinds": ["PICKUP", "RETURN", "ROUTINE"],
  "admin.inspections.slots": ["FRONT", "REAR", "DRIVER_SIDE", "PASSENGER_SIDE", "WHEELS", "ROOF", "INTERIOR", "DAMAGE", "DASHBOARD"],
  "admin.damages.ai": ["CONFIRMED", "DISMISSED"],
  "admin.damages.resp": ["CUSTOMER", "COMPANY", "INSURANCE", "THIRD_PARTY", "UNDETERMINED"],
  "admin.damages.statuses": ["REPORTED", "REVIEWING", "CUSTOMER_RESPONSIBLE", "COMPANY_RESPONSIBLE", "INSURANCE", "REPAIR_SCHEDULED", "REPAIRED", "CLOSED"],
  "admin.damages.types": ["SCRATCH", "DENT", "CRACK", "CHIP", "TEAR", "STAIN", "MISSING_PART", "MECHANICAL", "OTHER"],
  "admin.days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  "admin.maintenance.statuses": ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  "admin.maintenance.types": ["OIL", "TIRES", "BRAKES", "REPAIR", "INSPECTION", "CLEANING", "CUSTOM"],
  "admin.expenses.categories": ["MAINTENANCE", "REPAIR", "INSURANCE", "REGISTRATION", "CLEANING", "FUEL", "PARKING", "TOLL", "OTHER"],
  "admin.extras.billings": ["PER_DAY", "PER_BOOKING", "PER_UNIT", "FREE"],
  "admin.employees.status": ["INVITED", "ACTIVE", "SUSPENDED"],
  "admin.calendar.kinds": ["BOOKING", "MAINTENANCE", "CLEANING", "MANUAL", "TRANSFER"],
  "admin.calendar.views": ["day", "week", "month", "timeline"],
  "admin.messages.kinds": ["GENERAL", "BOOKING", "SUPPORT"],
  "admin.messages.sender": ["CUSTOMER", "STAFF", "SYSTEM"],
  "admin.onboarding.steps": ["business", "legal", "branding", "branches", "rules", "taxes", "payments", "vehicle", "pricing", "agreement", "launch"],
  "admin.pricing.kinds": ["WEEKEND_SURCHARGE", "AIRPORT_SURCHARGE", "DURATION_DISCOUNT", "YOUNG_DRIVER_FEE", "ADDITIONAL_DRIVER_FEE", "LEAD_TIME", "UTILIZATION"],
  "admin.pricing.appliesTo": ["RENTAL", "EXTRAS", "FEES"],
  "admin.reviews.dims": ["rating_car", "rating_cleanliness", "rating_service", "rating_pickup", "rating_value"],
  "admin.settings.events": ["booking_confirmed", "booking_cancelled", "payment_succeeded", "payment_failed", "pickup_reminder", "return_reminder", "rental_overdue", "deposit_updated", "staff_invited", "message_received"],
  "admin.settings.timing": ["FULL_AT_BOOKING", "PARTIAL_AT_BOOKING", "PAY_AT_PICKUP"],
  "admin.website.domainStatus": ["PENDING_VERIFICATION", "VERIFIED", "FAILED", "REMOVED"],
  "admin.branding.slots": ["logo_path", "logo_dark_path", "hero_image_path", "app_icon_path", "splash_path"],
  "admin.branding.themes": ["dark", "light", "system"],
  "vehicle.features": ["navigation", "bluetooth", "apple_carplay", "android_auto", "climate_control", "heated_seats", "sunroof", "parking_sensors", "rear_camera", "cruise_control", "tow_hitch", "child_seat_isofix"],
};

describe("admin dashboard translations", () => {
  it("every static key used in apps/admin exists in en and sq", () => {
    expect(staticKeys.length).toBeGreaterThan(400);
    expect(staticKeys.filter((k) => !has(en, k))).toEqual([]);
    expect(staticKeys.filter((k) => !has(sq, k))).toEqual([]);
  });

  it("every dynamic key prefix used in apps/admin is declared and fully translated", () => {
    const prefixes = new Set(sources.flatMap((s) => [...s.matchAll(/\bt\(\s*`(admin\.[a-zA-Z0-9_.]+)\.\$\{/g)].map((m) => m[1]!)));
    expect([...prefixes].filter((p) => !(p in DYNAMIC))).toEqual([]);
    const missing = Object.entries(DYNAMIC).flatMap(([p, vals]) => vals.map((v) => `${p}.${v}`)).filter((k) => !has(en, k) || !has(sq, k));
    expect(missing).toEqual([]);
  });

  it("every business error code has a message in both languages", () => {
    const missing = BUSINESS_ERROR_CODES.map((c) => `errors.${c}`).filter((k) => !has(en, k) || !has(sq, k));
    expect(missing).toEqual([]);
  });
});
