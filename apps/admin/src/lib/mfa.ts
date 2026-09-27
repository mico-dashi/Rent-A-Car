import "server-only";
import { redirect } from "next/navigation";
import { userClient } from "./supabase/server";

/**
 * Dashboard MFA policy (ADMIN_MFA_POLICY):
 * - "enrolled":   anyone who has enrolled TOTP must complete it (AAL2) every session;
 * - "privileged": additionally, owners, tenant admins and platform admins must enrol.
 * Production defaults to "privileged"; profiles.mfa_required forces enrolment for any user.
 */
export function mfaPolicy(): "enrolled" | "privileged" {
  const v = process.env.ADMIN_MFA_POLICY;
  if (v === "enrolled" || v === "privileged") return v;
  return process.env.NODE_ENV === "production" ? "privileged" : "enrolled";
}

export async function enforceMfa(opts: { privileged: boolean; next: string }) {
  const db = await userClient();
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") return;
  const goTo = `/mfa?next=${encodeURIComponent(opts.next)}`;
  if (aal?.nextLevel === "aal2") redirect(goTo); // enrolled but not verified in this session
  let required = opts.privileged && mfaPolicy() === "privileged";
  if (!required) {
    const { data: auth } = await db.auth.getUser();
    const { data: profile } = auth.user ? await db.from("profiles").select("mfa_required").eq("id", auth.user.id).maybeSingle() : { data: null };
    required = Boolean(profile?.mfa_required);
  }
  if (required) redirect(goTo);
}
