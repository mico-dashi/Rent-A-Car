"use server";

import { createHash, randomUUID } from "node:crypto";
import { computeReturnCharges } from "@rental/domain";
import { generateAgreement, signAgreement } from "@rental/server";
import { z } from "@rental/validation";
import { check, num, str, tenantAction, type ActionResult } from "@/lib/actions";
import { requestMeta } from "@/lib/request";
import { serviceClient, userClient } from "@/lib/supabase/server";

const MAX_PHOTO = 12 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

async function bookingOf(tenantId: string, bookingId: string | null) {
  const { data } = await (await userClient()).from("bookings").select("*").eq("id", bookingId ?? "").eq("tenant_id", tenantId).maybeSingle();
  if (!data) throw new Error("BOOKING_NOT_FOUND");
  return data;
}

export async function verifyLicenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "customers.documents", async (ctx) => {
    const status = str(fd, "status") === "REJECTED" ? "REJECTED" : "VERIFIED";
    check(await (await userClient()).from("driver_licenses").update({ verification_status: status, verified_by: ctx.userId, verified_at: new Date().toISOString() })
      .eq("id", str(fd, "licenseId")!).eq("tenant_id", ctx.tenantId));
  });
}

/** Create or update the inspection (offline-friendly: client may supply the id + version). */
export async function saveInspectionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "inspections.perform", async (ctx) => {
    const b = await bookingOf(ctx.tenantId, str(fd, "bookingId"));
    const kind = z.enum(["PICKUP", "RETURN"]).parse(str(fd, "kind"));
    const fields = {
      odometer_km: z.number().int().min(0).max(2_000_000).parse(num(fd, "odometer")),
      fuel_level_eighths: num(fd, "fuel"), battery_level_pct: num(fd, "battery"), notes: str(fd, "notes"),
      checklist: Object.fromEntries(["FRONT", "REAR", "DRIVER_SIDE", "PASSENGER_SIDE", "WHEELS", "ROOF", "INTERIOR"].map((s) => [s, fd.get(`check_${s}`) === "on"])),
      customer_accepted_at: fd.get("customerAccepted") === "on" ? new Date().toISOString() : null,
      status: fd.get("submit") === "1" ? "SUBMITTED" : "DRAFT",
    };
    if (fields.status === "SUBMITTED" && kind === "PICKUP" && !fields.customer_accepted_at) throw new Error("CUSTOMER_ACCEPTANCE_REQUIRED");
    const db = await userClient();
    const existing = (await db.from("vehicle_inspections").select("id,version").eq("booking_id", b.id).eq("kind", kind).maybeSingle()).data;
    if (existing) {
      check(await db.from("vehicle_inspections").update({ ...fields, version: num(fd, "version") ?? existing.version }).eq("id", existing.id));
    } else {
      check(await db.from("vehicle_inspections").insert({
        id: str(fd, "inspectionId") ?? randomUUID(), tenant_id: ctx.tenantId, vehicle_id: b.vehicle_id!, booking_id: b.id, kind, ...fields,
        performed_by: ctx.userId, performed_at: new Date().toISOString(),
      }));
    }
  });
}

export async function uploadPhotosAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "inspections.perform", async (ctx) => {
    const inspectionId = str(fd, "inspectionId");
    const slot = z.enum(["FRONT", "REAR", "DRIVER_SIDE", "PASSENGER_SIDE", "WHEELS", "ROOF", "INTERIOR", "DASHBOARD", "DAMAGE", "OTHER"]).parse(str(fd, "slot"));
    const { data: insp } = await (await userClient()).from("vehicle_inspections").select("id,tenant_id,status").eq("id", inspectionId ?? "").maybeSingle();
    if (!insp || insp.tenant_id !== ctx.tenantId) throw new Error("FORBIDDEN");
    if (insp.status === "LOCKED") throw new Error("BOOKING_NOT_MODIFIABLE");
    const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error("VALIDATION_FAILED");
    const svc = serviceClient();
    for (const f of files.slice(0, 12)) {
      if (!PHOTO_TYPES.includes(f.type) || f.size > MAX_PHOTO) throw new Error("VALIDATION_FAILED");
      const bytes = new Uint8Array(await f.arrayBuffer());
      const id = randomUUID();
      const ext = f.type.split("/")[1]!.replace("jpeg", "jpg");
      const path = `${ctx.tenantId}/${insp.id}/${slot.toLowerCase()}-${id}.${ext}`;
      const up = await svc.storage.from("inspection-photos").upload(path, bytes, { contentType: f.type });
      if (up.error) throw new Error(up.error.message);
      check(await (await userClient()).from("inspection_photos").insert({
        id, tenant_id: ctx.tenantId, inspection_id: insp.id, slot, storage_path: path, sha256: createHash("sha256").update(bytes).digest("hex"), captured_at: new Date().toISOString(),
      }));
    }
    return { ok: true, message: String(files.length) };
  });
}

export async function reportDamageAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "inspections.perform", async (ctx) => {
    const b = await bookingOf(ctx.tenantId, str(fd, "bookingId"));
    check(await (await userClient()).from("vehicle_damages").insert({
      tenant_id: ctx.tenantId, vehicle_id: b.vehicle_id!, booking_id: b.id, inspection_id: str(fd, "inspectionId"),
      damage_type: z.enum(["SCRATCH", "DENT", "CRACK", "CHIP", "TEAR", "STAIN", "MISSING_PART", "MECHANICAL", "OTHER"]).parse(str(fd, "damageType")),
      location: str(fd, "location"), description: z.string().min(3).max(2000).parse(str(fd, "description")),
      is_pre_existing: fd.get("preExisting") === "on", discovered_by: ctx.userId, status: "REPORTED",
    }));
  });
}

export async function generateAgreementAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "agreements.manage", async (ctx) => {
    const b = await bookingOf(ctx.tenantId, str(fd, "bookingId"));
    await generateAgreement(serviceClient(), b.id);
  });
}

export async function signAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "agreements.manage", async (ctx) => {
    const svc = serviceClient();
    const { data: a } = await svc.from("rental_agreements").select("id,tenant_id,booking_id").eq("id", str(fd, "agreementId") ?? "").maybeSingle();
    if (!a || a.tenant_id !== ctx.tenantId) throw new Error("FORBIDDEN");
    const role = str(fd, "role") === "EMPLOYEE" ? "EMPLOYEE" : "CUSTOMER";
    const { data: cust } = role === "CUSTOMER"
      ? await svc.from("bookings").select("customers(user_id)").eq("id", a.booking_id).single()
      : { data: null };
    const meta = await requestMeta();
    await signAgreement(svc, {
      agreementId: a.id, role, signerName: z.string().min(2).max(120).parse(str(fd, "signerName")),
      signerUserId: role === "EMPLOYEE" ? ctx.userId : ((cust as { customers?: { user_id: string | null } } | null)?.customers?.user_id ?? null),
      pngDataUrl: String(fd.get("signature") ?? ""), ip: meta.ip, userAgent: meta.userAgent,
    });
  });
}

/** Proposed post-rental charges (engine). Nothing is charged until staff confirm. */
export async function proposeReturnCharges(tenantId: string, bookingId: string) {
  const db = await userClient();
  const { data: b } = await db.from("bookings").select("*").eq("id", bookingId).eq("tenant_id", tenantId).single();
  const [{ data: pick }, { data: ret }, { data: v }, { data: s }] = await Promise.all([
    db.from("vehicle_inspections").select("*").eq("booking_id", bookingId).eq("kind", "PICKUP").maybeSingle(),
    db.from("vehicle_inspections").select("*").eq("booking_id", bookingId).eq("kind", "RETURN").maybeSingle(),
    db.from("vehicles").select("daily_rate_minor,extra_km_rate_minor").eq("id", b!.vehicle_id!).single(),
    db.from("tenant_settings").select("late_return_grace_minutes,fuel_policy,fuel_charge_per_eighth_minor").eq("tenant_id", tenantId).single(),
  ]);
  if (!b || !pick || !ret || !v || !s) return null;
  try {
    return computeReturnCharges({
      scheduledEnd: new Date(b.ends_at), actualReturn: new Date(ret.performed_at), graceMinutes: s.late_return_grace_minutes,
      dailyRateMinor: v.daily_rate_minor, pickupOdometerKm: pick.odometer_km, returnOdometerKm: ret.odometer_km,
      includedKm: b.included_km, extraKmRateMinor: v.extra_km_rate_minor, fuelPolicy: s.fuel_policy as "FULL_TO_FULL",
      pickupFuelEighths: pick.fuel_level_eighths, returnFuelEighths: ret.fuel_level_eighths, fuelChargePerEighthMinor: s.fuel_charge_per_eighth_minor,
      pickupBatteryPct: pick.battery_level_pct, returnBatteryPct: ret.battery_level_pct, batteryChargePerPctMinor: 0, batteryTolerancePct: 5,
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function confirmChargesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "payments.charge", async (ctx) => {
    const b = await bookingOf(ctx.tenantId, str(fd, "bookingId"));
    const proposal = await proposeReturnCharges(ctx.tenantId, b.id);
    if (!proposal || "error" in proposal) throw new Error("VALIDATION_FAILED");
    const chosen = new Set(fd.getAll("line").map(String));
    const lines = proposal.lines.filter((l, i) => chosen.has(String(i))).map((l) => ({
      kind: l.kind, label: l.label, label_params: l.labelParams ?? {}, quantity: l.quantity, unit_amount_minor: l.unitAmountMinor, amount_minor: l.amountMinor,
    }));
    if (!lines.length) return { ok: true };
    check(await (await userClient()).rpc("add_post_rental_charges", { p_booking: b.id, p_lines: lines }));
  });
}
