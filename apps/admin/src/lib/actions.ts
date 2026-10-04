import "server-only";
import { isBusinessErrorCode } from "@rental/types";
import { z } from "@rental/validation";

export type ActionResult =
  | { ok: true; message?: string; data?: Record<string, unknown> }
  | { ok: false; error: string; fields?: Record<string, string> }
  | null;

/** Normalise any thrown error / Supabase error into a safe, translatable code. */
export function failure(e: unknown): ActionResult {
  if (e instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[i.path.join(".")] = i.message;
    return { ok: false, error: "VALIDATION_FAILED", fields };
  }
  const message = (e as { message?: string })?.message?.trim() ?? "";
  const code = (e as { code?: string })?.code;
  if (isBusinessErrorCode(message)) return { ok: false, error: message };
  if (code === "42501" || /row-level security|permission denied/.test(message)) return { ok: false, error: "FORBIDDEN" };
  if (code === "23505") return { ok: false, error: "DUPLICATE" };
  if (code === "23P01" || /vehicle_blocks_no_overlap/.test(message)) return { ok: false, error: "VEHICLE_UNAVAILABLE" };
  if (code === "23503") return { ok: false, error: "IN_USE" };
  console.error(JSON.stringify({ level: "error", where: "server-action", message, code }));
  return { ok: false, error: "INTERNAL_ERROR" };
}

/** Throw on a Supabase error so `failure()` can map it. */
export function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data;
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
export const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === null ? null : Number(v);
};
/** Parse a major-unit money input ("125.50") into integer minor units without floats. */
export const money = (fd: FormData, k: string): number | null => {
  const v = str(fd, k);
  if (v === null) return null;
  const m = /^(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(v);
  if (!m) throw Object.assign(new Error("VALIDATION_FAILED"), {});
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";

import { revalidatePath } from "next/cache";
import type { Permission } from "@rental/types";
import { getTenantContext, type TenantContext } from "./session";

/**
 * Wrap a tenant-scoped server action: resolves the tenant from the slug in the
 * form, pre-checks the permission (fast, friendly error), runs the mutation
 * (which RLS / RPCs enforce again), maps errors, and revalidates the page.
 */
export async function tenantAction(fd: FormData, permission: Permission, fn: (ctx: TenantContext) => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    const slug = String(fd.get("_tenant") ?? "");
    const ctx = await getTenantContext(slug);
    if (!ctx.permissions.has(permission)) return { ok: false, error: "FORBIDDEN" };
    const res = await fn(ctx);
    const path = fd.get("_path");
    if (typeof path === "string" && path.startsWith("/t/")) revalidatePath(path);
    else revalidatePath(`/t/${slug}`, "layout");
    return res ?? { ok: true };
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    return failure(e);
  }
}
