"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { VEHICLE_CATEGORIES, VEHICLE_STATUSES } from "@rental/types";
import { z } from "@rental/validation";
import { bool, check, money, num, str, tenantAction, type ActionResult } from "@/lib/actions";
import { userClient } from "@/lib/supabase/server";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const FEATURES = ["navigation", "bluetooth", "apple_carplay", "android_auto", "climate_control", "heated_seats", "sunroof", "parking_sensors", "rear_camera", "cruise_control", "tow_hitch", "child_seat_isofix"];

function vehicleFields(fd: FormData) {
  return z.object({
    branch_id: z.string().uuid(), fleet_number: z.string().min(1).max(20), vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{11,17}$/).nullable(),
    registration_plate: z.string().min(2).max(20), make: z.string().min(1).max(40), model: z.string().min(1).max(60), trim: z.string().max(60).nullable(),
    year: z.number().int().min(1950).max(2100), category: z.enum(VEHICLE_CATEGORIES), exterior_color: z.string().max(40).nullable(), interior_color: z.string().max(40).nullable(),
    transmission: z.enum(["MANUAL", "AUTOMATIC"]), fuel_type: z.enum(["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"]),
    drivetrain: z.enum(["FWD", "RWD", "AWD", "FOUR_WD"]).nullable(), seats: z.number().int().min(1).max(60), doors: z.number().int().min(0).max(8),
    luggage: z.number().int().min(0).max(30).nullable(), engine: z.string().max(60).nullable(), horsepower: z.number().int().min(0).max(3000).nullable(),
    electric_range_km: z.number().int().min(0).max(2000).nullable(), odometer_km: z.number().int().min(0), purchase_price_minor: z.number().int().min(0).nullable(),
    estimated_value_minor: z.number().int().min(0).nullable(), hourly_rate_minor: z.number().int().min(0).nullable(), daily_rate_minor: z.number().int().min(0),
    weekly_rate_minor: z.number().int().min(0).nullable(), monthly_rate_minor: z.number().int().min(0).nullable(), deposit_minor: z.number().int().min(0),
    minimum_driver_age: z.number().int().min(16).max(99), included_km_per_day: z.number().int().min(0).nullable(), extra_km_rate_minor: z.number().int().min(0),
    description: z.string().max(2000).nullable(), is_published: z.boolean(),
  }).parse({
    branch_id: str(fd, "branch_id"), fleet_number: str(fd, "fleet_number"), vin: str(fd, "vin")?.toUpperCase() ?? null, registration_plate: str(fd, "registration_plate"),
    make: str(fd, "make"), model: str(fd, "model"), trim: str(fd, "trim"), year: num(fd, "year"), category: str(fd, "category"),
    exterior_color: str(fd, "exterior_color"), interior_color: str(fd, "interior_color"), transmission: str(fd, "transmission"), fuel_type: str(fd, "fuel_type"),
    drivetrain: str(fd, "drivetrain"), seats: num(fd, "seats"), doors: num(fd, "doors"), luggage: num(fd, "luggage"), engine: str(fd, "engine"),
    horsepower: num(fd, "horsepower"), electric_range_km: num(fd, "electric_range_km"), odometer_km: num(fd, "odometer_km") ?? 0,
    purchase_price_minor: money(fd, "purchase_price"), estimated_value_minor: money(fd, "estimated_value"), hourly_rate_minor: money(fd, "hourly_rate"),
    daily_rate_minor: money(fd, "daily_rate"), weekly_rate_minor: money(fd, "weekly_rate"), monthly_rate_minor: money(fd, "monthly_rate"),
    deposit_minor: money(fd, "deposit") ?? 0, minimum_driver_age: num(fd, "minimum_driver_age") ?? 21, included_km_per_day: num(fd, "included_km_per_day"),
    extra_km_rate_minor: money(fd, "extra_km_rate") ?? 0, description: str(fd, "description"), is_published: bool(fd, "is_published"),
  });
}

export async function createVehicleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const res = await tenantAction(fd, "vehicles.write", async (ctx) => {
    const v = vehicleFields(fd);
    const row = check(await (await userClient()).from("vehicles").insert({ ...v, tenant_id: ctx.tenantId, currency: ctx.currency,
      fuel_level_eighths: v.fuel_type === "ELECTRIC" ? null : 8, battery_level_pct: v.fuel_type === "ELECTRIC" ? 100 : null }).select("id").single());
    id = row!.id;
  });
  if (res?.ok && id) redirect(`/t/${fd.get("_tenant")}/fleet/${id}`);
  return res;
}

export async function updateVehicleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.write", async (ctx) => {
    const v = vehicleFields(fd);
    check(await (await userClient()).from("vehicles").update(v).eq("id", str(fd, "vehicleId")!).eq("tenant_id", ctx.tenantId));
  });
}

export async function setStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.status", async (ctx) => {
    const status = z.enum(VEHICLE_STATUSES).parse(str(fd, "status"));
    check(await (await userClient()).from("vehicles").update({ status }).eq("id", str(fd, "vehicleId")!).eq("tenant_id", ctx.tenantId));
  });
}

export async function setFeaturesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.write", async (ctx) => {
    const vehicleId = str(fd, "vehicleId")!;
    const chosen = fd.getAll("features").map(String).filter((f) => FEATURES.includes(f));
    const db = await userClient();
    check(await db.from("vehicle_features").delete().eq("vehicle_id", vehicleId).eq("tenant_id", ctx.tenantId));
    if (chosen.length) check(await db.from("vehicle_features").insert(chosen.map((feature) => ({ tenant_id: ctx.tenantId, vehicle_id: vehicleId, feature }))));
  });
}

async function assertVehicle(tenantId: string, vehicleId: string | null) {
  const { data } = await (await userClient()).from("vehicles").select("id").eq("id", vehicleId ?? "").eq("tenant_id", tenantId).maybeSingle();
  if (!data) throw new Error("FORBIDDEN");
  return data.id;
}

export async function uploadImagesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.write", async (ctx) => {
    const vehicleId = await assertVehicle(ctx.tenantId, str(fd, "vehicleId"));
    const files = fd.getAll("images").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 10);
    if (!files.length) throw new Error("VALIDATION_FAILED");
    const db = await userClient();
    const { count } = await db.from("vehicle_images").select("*", { count: "exact", head: true }).eq("vehicle_id", vehicleId);
    let order = count ?? 0;
    for (const f of files) {
      if (!IMAGE_TYPES.includes(f.type) || f.size > 10 * 1024 * 1024) throw new Error("VALIDATION_FAILED");
      const path = `${ctx.tenantId}/${vehicleId}/${randomUUID()}.${f.type.split("/")[1]!.replace("jpeg", "jpg")}`;
      // Staff upload with their own session: storage RLS requires vehicles.write for this tenant path.
      const up = await db.storage.from("vehicle-media").upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: f.type });
      if (up.error) throw new Error(up.error.message);
      check(await db.from("vehicle_images").insert({ tenant_id: ctx.tenantId, vehicle_id: vehicleId, storage_path: path, thumbnail_path: path, sort_order: order++, alt_text: str(fd, "alt") }));
    }
  });
}

export async function deleteImageAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.write", async (ctx) => {
    const db = await userClient();
    const img = check(await db.from("vehicle_images").select("id,storage_path").eq("id", str(fd, "imageId")!).eq("tenant_id", ctx.tenantId).single());
    if (!img!.storage_path.startsWith("demo/")) await db.storage.from("vehicle-media").remove([img!.storage_path]);
    check(await db.from("vehicle_images").delete().eq("id", img!.id));
  });
}

export async function makeCoverAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.write", async (ctx) => {
    const db = await userClient();
    const vehicleId = await assertVehicle(ctx.tenantId, str(fd, "vehicleId"));
    const { data: imgs } = await db.from("vehicle_images").select("id").eq("vehicle_id", vehicleId).order("sort_order");
    const ordered = [str(fd, "imageId")!, ...(imgs ?? []).map((i) => i.id).filter((i) => i !== str(fd, "imageId"))];
    for (const [i, imageId] of ordered.entries()) check(await db.from("vehicle_images").update({ sort_order: i }).eq("id", imageId));
  });
}

export async function addDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.write", async (ctx) => {
    const vehicleId = await assertVehicle(ctx.tenantId, str(fd, "vehicleId"));
    const file = fd.get("file");
    let path: string | null = null;
    const db = await userClient();
    if (file instanceof File && file.size > 0) {
      if (!DOC_TYPES.includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error("VALIDATION_FAILED");
      path = `${ctx.tenantId}/${vehicleId}/${randomUUID()}-${file.name.replace(/[^\w.-]/g, "_").slice(-60)}`;
      const up = await db.storage.from("vehicle-documents").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
    }
    check(await db.from("vehicle_documents").insert({
      tenant_id: ctx.tenantId, vehicle_id: vehicleId, kind: z.enum(["REGISTRATION", "INSURANCE", "INSPECTION", "OWNERSHIP", "LEASE", "SERVICE_RECORD", "OTHER"]).parse(str(fd, "kind")),
      storage_path: path, reference_number: str(fd, "reference"), issued_on: str(fd, "issued_on"), expires_on: str(fd, "expires_on"), notes: str(fd, "notes"),
    }));
  });
}

export async function deleteDocumentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.write", async (ctx) => {
    check(await (await userClient()).from("vehicle_documents").delete().eq("id", str(fd, "documentId")!).eq("tenant_id", ctx.tenantId));
  });
}

export async function setClassAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.write", async (ctx) => {
    const vehicleId = await assertVehicle(ctx.tenantId, str(fd, "vehicleId"));
    const db = await userClient();
    check(await db.from("vehicle_class_members").delete().eq("vehicle_id", vehicleId));
    const classId = str(fd, "classId");
    if (classId) check(await db.from("vehicle_class_members").insert({ tenant_id: ctx.tenantId, class_id: classId, vehicle_id: vehicleId }));
  });
}

export async function scheduleTransferAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "transfers.manage", async (ctx) => {
    const { zonedLocalToUtc } = await import("@rental/domain");
    const vehicleId = await assertVehicle(ctx.tenantId, str(fd, "vehicleId"));
    const { data: v } = await (await userClient()).from("vehicles").select("branch_id").eq("id", vehicleId).single();
    check(await (await userClient()).from("vehicle_transfers").insert({
      tenant_id: ctx.tenantId, vehicle_id: vehicleId, from_branch_id: v!.branch_id, to_branch_id: str(fd, "toBranchId")!,
      depart_at: zonedLocalToUtc(str(fd, "depart")!, ctx.timezone).toISOString(), arrive_at: zonedLocalToUtc(str(fd, "arrive")!, ctx.timezone).toISOString(),
      driver_membership_id: str(fd, "driverMembershipId"), notes: str(fd, "notes"),
    }));
  });
}

export async function transferStatusAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "transfers.manage", async (ctx) => {
    check(await (await userClient()).from("vehicle_transfers").update({ status: z.enum(["IN_TRANSIT", "COMPLETED", "CANCELLED"]).parse(str(fd, "status")) })
      .eq("id", str(fd, "transferId")!).eq("tenant_id", ctx.tenantId));
  });
}

export async function saveClassAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return tenantAction(fd, "vehicles.write", async (ctx) => {
    const row = {
      tenant_id: ctx.tenantId, code: z.string().min(2).max(12).parse(str(fd, "code")?.toUpperCase()), name: z.string().min(2).max(60).parse(str(fd, "name")),
      category: z.enum(VEHICLE_CATEGORIES).parse(str(fd, "category")), rank: num(fd, "rank") ?? 100, equivalence_group: str(fd, "equivalence_group"),
      daily_rate_minor: money(fd, "daily_rate") ?? 0, deposit_minor: money(fd, "deposit") ?? 0, description: str(fd, "description"),
    };
    const id = str(fd, "classId");
    const db = await userClient();
    check(id ? await db.from("vehicle_classes").update(row).eq("id", id).eq("tenant_id", ctx.tenantId) : await db.from("vehicle_classes").insert(row));
  });
}

