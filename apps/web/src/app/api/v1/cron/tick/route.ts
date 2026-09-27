import { NextResponse } from "next/server";
import { hostingFromEnv, runScheduledJobs, sendersFromEnv } from "@rental/server";
import { cronAuthorized } from "@/lib/cron";
import { serverEnv } from "@/lib/env";
import { paymentProvider } from "@/lib/payments";
import { serviceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduler tick (every 5 minutes): holds, overdue/no-show housekeeping and
 * reminders, deposit authorisations, cancellation refunds, notification
 * delivery and custom-domain verification. Returns 207 when a job failed.
 */
async function handler(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const env = serverEnv();
  const results = await runScheduledJobs(serviceClient(), { provider: paymentProvider(), senders: sendersFromEnv(env), hosting: hostingFromEnv(env) });
  const failed = Object.values(results).some((r) => !r.ok);
  return NextResponse.json({ results }, { status: failed ? 207 : 200 });
}
export { handler as GET, handler as POST };
