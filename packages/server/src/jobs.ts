import type { SupabaseClient } from "@rental/auth";
import { ExpoPushSender, ResendEmailSender, TwilioSmsSender } from "@rental/notifications";
import type { PaymentProvider } from "@rental/payments";
import { dispatchNotifications, type Senders } from "./dispatch";
import { VercelDomains, verifyPendingDomains, type HostingDomains, type TxtLookup } from "./domains";
import { authorizeDueDeposits, refundCancelledBookings } from "./payments-ops";

export interface JobsEnv {
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM_DOMAIN?: string | undefined;
  EXPO_ACCESS_TOKEN?: string | undefined;
  TWILIO_ACCOUNT_SID?: string | undefined;
  TWILIO_AUTH_TOKEN?: string | undefined;
  TWILIO_FROM_NUMBER?: string | undefined;
  VERCEL_TOKEN?: string | undefined;
  VERCEL_PROJECT_ID?: string | undefined;
  VERCEL_TEAM_ID?: string | undefined;
}

/** Channel senders for whatever providers are configured. Unconfigured channels fail visibly in dispatch. */
export function sendersFromEnv(env: JobsEnv): Senders {
  const senders: Senders = { PUSH: new ExpoPushSender(env.EXPO_ACCESS_TOKEN) };
  if (env.RESEND_API_KEY && env.EMAIL_FROM_DOMAIN) senders.EMAIL = new ResendEmailSender(env.RESEND_API_KEY, `notifications@${env.EMAIL_FROM_DOMAIN}`);
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) senders.SMS = new TwilioSmsSender(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER);
  return senders;
}

export function hostingFromEnv(env: JobsEnv): HostingDomains | null {
  return env.VERCEL_TOKEN && env.VERCEL_PROJECT_ID ? new VercelDomains(env.VERCEL_TOKEN, env.VERCEL_PROJECT_ID, env.VERCEL_TEAM_ID) : null;
}

export interface JobDeps {
  provider: PaymentProvider | null;
  senders: Senders;
  hosting: HostingDomains | null;
  txtLookup?: TxtLookup;
}

export type JobResult = { ok: true; result: unknown } | { ok: false; error: string } | { ok: true; skipped: string };

/**
 * One scheduler tick (run every few minutes). Each job is isolated: a failure
 * is reported but never prevents the others from running. All jobs are
 * idempotent, so overlapping or repeated ticks are safe.
 */
export async function runScheduledJobs(db: SupabaseClient, deps: JobDeps): Promise<Record<string, JobResult>> {
  const jobs: [string, () => Promise<unknown> | null][] = [
    ["releaseHolds", async () => { const { data, error } = await db.rpc("release_expired_holds", { p_vehicle: null }); if (error) throw new Error(error.message); return data; }],
    ["housekeeping", async () => { const { data, error } = await db.rpc("run_housekeeping"); if (error) throw new Error(error.message); return data; }],
    ["authorizeDeposits", () => (deps.provider ? authorizeDueDeposits(db, deps.provider) : null)],
    ["cancellationRefunds", () => (deps.provider ? refundCancelledBookings(db, deps.provider) : null)],
    ["notifications", () => dispatchNotifications(db, deps.senders)],
    ["domains", () => verifyPendingDomains(db, deps.hosting, deps.txtLookup)],
  ];
  const out: Record<string, JobResult> = {};
  for (const [name, run] of jobs) {
    try {
      const p = run();
      out[name] = p === null ? { ok: true, skipped: "payments not configured" } : { ok: true, result: await p };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(JSON.stringify({ level: "error", where: "cron", job: name, error }));
      out[name] = { ok: false, error };
    }
  }
  return out;
}
