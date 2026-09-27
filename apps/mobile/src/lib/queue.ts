import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { syncInspection, syncInspectionPhoto, type InspectionDraft, type PhotoDraft } from "@rental/api-client";
import { OfflineQueue, type QueuedOp } from "./offline-queue";
import { supabase } from "./supabase";

/** App-wide outbox for staff inspections and photos (see offline-queue.ts for the sync rules). */
export const queue = new OfflineQueue(AsyncStorage);

export type PhotoOp = PhotoDraft & { localUri: string };

export function enqueueInspection(d: InspectionDraft, baseVersion: number | null) {
  return queue.enqueue({ id: `inspection:${d.id}`, type: "inspection", payload: d, baseVersion });
}

export function enqueuePhoto(p: PhotoOp) {
  return queue.enqueue({ id: `photo:${p.id}`, type: "photo", payload: p, baseVersion: null });
}

async function readBytes(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri); // file:// URIs from the camera/picker
  return res.arrayBuffer();
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function execute(op: QueuedOp) {
  const db = supabase();
  if (op.type === "inspection") return syncInspection(db, op.payload as InspectionDraft, op.baseVersion);
  if (op.type === "photo") {
    const p = op.payload as PhotoOp;
    const bytes = await readBytes(p.localUri);
    return syncInspectionPhoto(db, { ...p, sha256: p.sha256 ?? (await sha256Hex(bytes)) }, bytes);
  }
  return { ok: false as const, kind: "rejected" as const, error: "VALIDATION_FAILED" };
}

export function syncNow() {
  return queue.sync(execute);
}
