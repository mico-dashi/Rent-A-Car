import "server-only";
import type { SupabaseClient } from "@rental/auth";
import {
  ageOn, quote, utilization, type OccupancyBlock, type PricingRule, type Quote, type QuoteInput, type SeasonalRate,
  type SelectedExtra, type TaxRule,
} from "@rental/domain";
import { BusinessError, type CurrencyCode, type PaymentTiming, type VehicleCategory } from "@rental/types";
import type { QuoteRequest } from "@rental/validation";

type Row = Record<string, unknown>;

async function one<T = Row>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data as T | null) ?? null;
}
async function many<T = Row>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data as T[] | null) ?? [];
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface PricingContext {
  input: QuoteInput;
  quote: Quote;
  vehicle: Row | null;
  classId: string | null;
  discountCodeId: string | null;
  settings: Row;
}

/**
 * Load every pricing input for a request from the database (service role,
 * tenant-scoped explicitly) and run the deterministic engine. The browser
 * never supplies prices — only choices.
 */
export async function buildQuote(db: SupabaseClient, tenantId: string, req: QuoteRequest, opts: { now?: Date; driverDob?: string | null } = {}): Promise<PricingContext> {
  const now = opts.now ?? new Date();
  const settings = await one(db.from("tenant_settings").select("*").eq("tenant_id", tenantId).single());
  const tenant = await one<{ base_currency: string }>(db.from("tenants").select("base_currency").eq("id", tenantId).single());
  if (!settings || !tenant) throw new BusinessError("TENANT_NOT_ACTIVE");

  const pickup = await one<Row>(db.from("branches").select("id,timezone,airport_code").eq("tenant_id", tenantId).eq("id", req.pickupBranchId).eq("is_active", true).maybeSingle());
  const ret = await one<Row>(db.from("branches").select("id").eq("tenant_id", tenantId).eq("id", req.returnBranchId).eq("is_active", true).maybeSingle());
  if (!pickup || !ret) throw new BusinessError("BRANCH_NOT_FOUND");

  let vehicle: Row | null = null;
  let rates: QuoteInput["vehicle"];
  let classId: string | null = null;
  if (req.vehicleId) {
    vehicle = await one<Row>(db.from("vehicles").select("*").eq("tenant_id", tenantId).eq("id", req.vehicleId).eq("is_published", true).maybeSingle());
    if (!vehicle) throw new BusinessError("VEHICLE_NOT_BOOKABLE");
    rates = {
      category: vehicle.category as VehicleCategory,
      hourlyRateMinor: num(vehicle.hourly_rate_minor), dailyRateMinor: Number(vehicle.daily_rate_minor),
      weeklyRateMinor: num(vehicle.weekly_rate_minor), monthlyRateMinor: num(vehicle.monthly_rate_minor),
      depositMinor: Number(vehicle.deposit_minor), includedKmPerDay: num(vehicle.included_km_per_day),
    };
  } else {
    const cls = await one<Row>(db.from("vehicle_classes").select("*").eq("tenant_id", tenantId).eq("id", req.vehicleClassId!).maybeSingle());
    if (!cls) throw new BusinessError("CLASS_NOT_FOUND");
    classId = cls.id as string;
    rates = {
      category: cls.category as VehicleCategory, hourlyRateMinor: null, dailyRateMinor: Number(cls.daily_rate_minor),
      weeklyRateMinor: null, monthlyRateMinor: null, depositMinor: Number(cls.deposit_minor), includedKmPerDay: null,
    };
  }

  const oneWay = req.pickupBranchId === req.returnBranchId ? null
    : await one<Row>(db.from("one_way_fees").select("fee_minor,allowed").eq("tenant_id", tenantId)
        .eq("from_branch_id", req.pickupBranchId).eq("to_branch_id", req.returnBranchId).maybeSingle());
  if (oneWay && oneWay.allowed === false) throw new BusinessError("ONE_WAY_NOT_ALLOWED");

  const [ruleRows, seasonalRows, taxRows, extraRows] = await Promise.all([
    many(db.from("pricing_rules").select("*").eq("tenant_id", tenantId).eq("is_active", true)),
    many(db.from("seasonal_rates").select("*").eq("tenant_id", tenantId)),
    many(db.from("tax_rules").select("*").eq("tenant_id", tenantId)),
    req.extras.length ? many(db.from("extras").select("*").eq("tenant_id", tenantId).eq("is_active", true).in("id", req.extras.map((e) => e.extraId))) : Promise.resolve([] as Row[]),
  ]);
  if (extraRows.length !== req.extras.length) throw new BusinessError("EXTRA_NOT_FOUND");

  let discount: QuoteInput["discount"] = null;
  let discountCodeId: string | null = null;
  if (req.discountCode) {
    const d = await one<Row>(db.from("discount_codes").select("*").eq("tenant_id", tenantId).ilike("code", req.discountCode).eq("is_active", true).maybeSingle());
    const valid = d && (!d.valid_from || Date.parse(d.valid_from as string) <= now.getTime()) && (!d.valid_until || Date.parse(d.valid_until as string) > now.getTime())
      && (d.max_redemptions === null || Number(d.redemptions) < Number(d.max_redemptions));
    if (!valid) throw new BusinessError("DISCOUNT_CODE_INVALID");
    discountCodeId = d.id as string;
    discount = { id: d.id as string, code: d.code as string, percentOffBps: num(d.percent_off_bps), amountOffMinor: num(d.amount_off_minor), minRentalDays: num(d.min_rental_days) };
  }

  // Utilization for dynamic rules: occupancy of the tenant's published fleet across the requested window.
  let util = 0;
  if (settings.dynamic_pricing_enabled) {
    const vehicles = await many<{ id: string }>(db.from("vehicles").select("id").eq("tenant_id", tenantId).eq("is_published", true));
    const blocks = await many<Row>(db.from("vehicle_availability_blocks").select("id,vehicle_id,kind,period,hold_expires_at,released_at")
      .eq("tenant_id", tenantId).is("released_at", null));
    util = utilization(vehicles.map((v) => v.id), { start: new Date(req.startsAt), end: new Date(req.endsAt) }, blocks.map(toBlock), now);
  }

  const qty = new Map(req.extras.map((e) => [e.extraId, e.quantity]));
  const extras: SelectedExtra[] = extraRows.map((e) => {
    const quantity = qty.get(e.id as string) ?? 1;
    if (quantity > Number(e.max_quantity)) throw new BusinessError("VALIDATION_FAILED");
    return {
      id: e.id as string, code: e.code as string, name: e.name as string, kind: e.kind as "EXTRA" | "INSURANCE",
      billing: e.billing as SelectedExtra["billing"], priceMinor: Number(e.price_minor), maxPriceMinor: num(e.max_price_minor),
      quantity, depositReductionBps: Number(e.deposit_reduction_bps),
    };
  });

  const driverDob = opts.driverDob ?? req.driverDateOfBirth ?? null;
  const input: QuoteInput = {
    currency: tenant.base_currency as CurrencyCode,
    startsAt: new Date(req.startsAt),
    endsAt: new Date(req.endsAt),
    now,
    timeZone: pickup.timezone as string,
    vehicle: rates,
    pickupIsAirport: pickup.airport_code !== null || req.pickupType === "AIRPORT",
    oneWayFeeMinor: oneWay ? Number(oneWay.fee_minor) : 0,
    deliveryFeeMinor: 0, // delivery quotes come from the maps module once an address is geocoded (Phase 17)
    driverAge: driverDob ? ageOn(driverDob, new Date(req.startsAt)) : null,
    additionalDrivers: req.additionalDrivers,
    extras,
    rules: ruleRows.map((r): PricingRule => ({
      id: r.id as string, name: r.name as string, kind: r.kind as PricingRule["kind"], isDynamic: Boolean(r.is_dynamic),
      condition: (r.condition ?? {}) as PricingRule["condition"], adjustmentBps: num(r.adjustment_bps), amountMinor: num(r.amount_minor),
      per: r.per as PricingRule["per"], priority: Number(r.priority), isActive: Boolean(r.is_active),
    })),
    seasonalRates: seasonalRows.map((s): SeasonalRate => ({
      id: s.id as string, name: s.name as string, startsOn: s.starts_on as string, endsOn: s.ends_on as string,
      adjustmentBps: Number(s.adjustment_bps), category: (s.category as VehicleCategory | null) ?? null, priority: Number(s.priority),
    })),
    taxRules: taxRows.map((t): TaxRule => ({
      id: t.id as string, name: t.name as string, rateBps: Number(t.rate_bps), isInclusive: Boolean(t.is_inclusive),
      appliesTo: t.applies_to as TaxRule["appliesTo"], effectiveFrom: t.effective_from as string, effectiveTo: (t.effective_to as string | null) ?? null,
    })),
    discount,
    dynamic: {
      enabled: Boolean(settings.dynamic_pricing_enabled), utilization: util,
      floorBps: Number(settings.price_floor_bps), ceilingBps: Number(settings.price_ceiling_bps),
    },
    graceMinutes: Number(settings.late_return_grace_minutes),
    paymentTiming: settings.payment_timing as PaymentTiming,
    partialPaymentBps: Number(settings.partial_payment_bps),
  };

  try {
    return { input, quote: quote(input), vehicle, classId, discountCodeId, settings };
  } catch (e) {
    if (e instanceof Error && e.message === "DISCOUNT_CODE_INVALID") throw new BusinessError("DISCOUNT_CODE_INVALID");
    throw e;
  }
}

function toBlock(r: Row): OccupancyBlock {
  // tstzrange text form: ["2026-10-01 10:00:00+00","2026-10-03 11:00:00+00")
  const m = /^[[(]"?([^",]+)"?,"?([^")]+)"?[\])]$/.exec(String(r.period));
  return {
    id: r.id as string, vehicleId: r.vehicle_id as string, kind: r.kind as OccupancyBlock["kind"],
    period: { start: new Date(m?.[1] ?? 0), end: new Date(m?.[2] ?? 0) },
    holdExpiresAt: r.hold_expires_at ? new Date(r.hold_expires_at as string) : null,
    releasedAt: r.released_at ? new Date(r.released_at as string) : null,
  };
}
