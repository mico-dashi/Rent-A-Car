import type { SupabaseClient } from "@supabase/supabase-js";
import { isBusinessErrorCode } from "@rental/types";

/**
 * Offline-first inspection sync used by the staff mobile app. Records are
 * created with client-generated ids; every write goes through RLS
 * (`inspections.perform`) and the server's version guard, so a stale device
 * can never overwrite someone else's newer edit.
 */

export const INSPECTION_SLOTS = ["FRONT", "REAR", "DRIVER_SIDE", "PASSENGER_SIDE", "WHEELS", "ROOF", "INTERIOR"] as const;
export const PHOTO_SLOTS = [...INSPECTION_SLOTS, "DASHBOARD", "DAMAGE", "OTHER"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

export interface InspectionDraft {
  id: string;
  tenantId: string;
  bookingId: string;
  vehicleId: string;
  kind: "PICKUP" | "RETURN";
  odometerKm: number;
  fuelEighths: number | null;
  batteryPct: number | null;
  checklist: Partial<Record<(typeof INSPECTION_SLOTS)[number], boolean>>;
  notes: string | null;
  customerAccepted: boolean;
  submit: boolean;
  performedBy: string;
  performedAt: string;
}

export interface PhotoDraft {
  id: string;
  tenantId: string;
  inspectionId: string;
  slot: PhotoSlot;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/heic";
  capturedAt: string;
  sha256: string | null;
}

export type SyncResult = { ok: true; version?: number } | { ok: false; kind: "network" | "conflict" | "rejected"; error: string; serverVersion?: number };

interface PgError { message: string; code?: string; details?: string | null }

/** Map a PostgREST / storage error to a sync outcome. */
export function classifySyncError(e: PgError): SyncResult {
  const msg = (e.message ?? "").trim();
  if (!e.code && /network|failed to fetch|fetch failed|timed? ?out|ECONN|ENOTFOUND|aborted/i.test(msg)) return { ok: false, kind: "network", error: "NETWORK" };
  if (e.code === "40001" || msg === "VERSION_CONFLICT" || /version conflict/i.test(msg)) return { ok: false, kind: "conflict", error: "VERSION_CONFLICT" };
  if (e.code === "42501" || /row-level security|permission denied/i.test(msg)) return { ok: false, kind: "rejected", error: "FORBIDDEN" };
  if (/locked/i.test(msg)) return { ok: false, kind: "rejected", error: "BOOKING_NOT_MODIFIABLE" };
  if (isBusinessErrorCode(msg)) return { ok: false, kind: "rejected", error: msg };
  if (e.code === "P0001" || e.code === "23514") return { ok: false, kind: "rejected", error: "VALIDATION_FAILED" };
  return { ok: false, kind: "rejected", error: "INTERNAL_ERROR" };
}

function row(d: InspectionDraft) {
  return {
    odometer_km: d.odometerKm,
    fuel_level_eighths: d.fuelEighths,
    battery_level_pct: d.batteryPct,
    checklist: d.checklist,
    notes: d.notes,
    customer_accepted_at: d.customerAccepted ? d.performedAt : null,
    client_updated_at: new Date().toISOString(),
    status: d.submit ? "SUBMITTED" : "DRAFT",
  };
}

/** Create or update one inspection. `baseVersion` is the server version the local edit started from. */
export async function syncInspection(db: SupabaseClient, d: InspectionDraft, baseVersion: number | null): Promise<SyncResult> {
  if (d.submit && d.kind === "PICKUP" && !d.customerAccepted) return { ok: false, kind: "rejected", error: "CUSTOMER_ACCEPTANCE_REQUIRED" };
  try {
    const found = await db.from("vehicle_inspections").select("id,version,status").eq("booking_id", d.bookingId).eq("kind", d.kind).maybeSingle();
    if (found.error) return classifySyncError(found.error);
    const server = found.data as { id: string; version: number; status: string } | null;

    if (!server) {
      const ins = await db.from("vehicle_inspections").insert({
        id: d.id, tenant_id: d.tenantId, vehicle_id: d.vehicleId, booking_id: d.bookingId, kind: d.kind,
        performed_by: d.performedBy, performed_at: d.performedAt, ...row(d),
      }).select("version").single();
      if (ins.error) {
        if (ins.error.code === "23505") return { ok: false, kind: "conflict", error: "VERSION_CONFLICT" }; // created on another device meanwhile
        return classifySyncError(ins.error);
      }
      return { ok: true, version: (ins.data as { version: number }).version };
    }

    if (server.status === "LOCKED") return { ok: false, kind: "rejected", error: "BOOKING_NOT_MODIFIABLE" };
    // A record another device created is a conflict unless we started from it.
    if (server.id !== d.id && baseVersion === null) return { ok: false, kind: "conflict", error: "VERSION_CONFLICT", serverVersion: server.version };
    const version = baseVersion ?? server.version; // our own record (earlier response lost): edit on top of it
    const upd = await db.from("vehicle_inspections").update({ ...row(d), version }).eq("id", server.id).select("version").single();
    if (upd.error) {
      const r = classifySyncError(upd.error);
      return r.ok || r.kind !== "conflict" ? r : { ...r, serverVersion: server.version };
    }
    return { ok: true, version: (upd.data as { version: number }).version };
  } catch (e) {
    return classifySyncError({ message: e instanceof Error ? e.message : String(e) });
  }
}

/** Upload one photo (idempotent by id: re-running after a lost response is harmless). */
export async function syncInspectionPhoto(db: SupabaseClient, p: PhotoDraft, bytes: ArrayBuffer | Uint8Array): Promise<SyncResult> {
  const ext = p.contentType.split("/")[1]!.replace("jpeg", "jpg");
  const path = `${p.tenantId}/${p.inspectionId}/${p.slot.toLowerCase()}-${p.id}.${ext}`;
  try {
    const up = await db.storage.from("inspection-photos").upload(path, bytes, { contentType: p.contentType, upsert: true });
    if (up.error) return classifySyncError({ message: up.error.message, code: (up.error as { statusCode?: string }).statusCode === "403" ? "42501" : undefined });
    const ins = await db.from("inspection_photos").insert({
      id: p.id, tenant_id: p.tenantId, inspection_id: p.inspectionId, slot: p.slot, storage_path: path, sha256: p.sha256, captured_at: p.capturedAt,
    });
    if (ins.error && ins.error.code !== "23505") return classifySyncError(ins.error);
    return { ok: true };
  } catch (e) {
    return classifySyncError({ message: e instanceof Error ? e.message : String(e) });
  }
}
