"use server";

import { userClient } from "@/lib/supabase/server";

export type MfaState = { ok: boolean; error?: string; enroll?: { factorId: string; qr: string; secret: string } } | null;

/**
 * TOTP enrolment and verification run on the server with the cookie session
 * (auth cookies are httpOnly, so the browser client never holds the tokens).
 */
export async function startEnrollment(): Promise<MfaState> {
  const db = await userClient();
  // Drop stale unverified factors from abandoned attempts so enrolment can restart.
  const { data: factors } = await db.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) if (f.status !== "verified") await db.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await db.auth.mfa.enroll({ factorType: "totp" });
  if (error || !data) return { ok: false, error: error?.message ?? "INTERNAL_ERROR" };
  return { ok: true, enroll: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

export async function verifyCode(factorId: string | null, code: string): Promise<MfaState> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "VALIDATION_FAILED" };
  const db = await userClient();
  let id = factorId;
  if (!id) {
    const { data } = await db.auth.mfa.listFactors();
    id = data?.totp?.find((f) => f.status === "verified")?.id ?? null;
  }
  if (!id) return { ok: false, error: "NOT_FOUND" };
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId: id, code });
  return error ? { ok: false, error: "VALIDATION_FAILED" } : { ok: true };
}
