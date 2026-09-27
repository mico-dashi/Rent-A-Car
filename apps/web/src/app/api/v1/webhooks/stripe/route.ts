import { processWebhook } from "@rental/payments";
import { NextResponse } from "next/server";
import { paymentProvider, supabaseWebhookStore, webhookHandlers } from "@/lib/payments";
import { serviceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Stripe webhook: signature-verified, persisted before processing, idempotent, retry-safe. */
export async function POST(req: Request) {
  const provider = paymentProvider();
  if (!provider) return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  const rawBody = await req.text(); // must be the exact raw body for signature verification
  const db = serviceClient();
  const outcome = await processWebhook(provider, rawBody, req.headers.get("stripe-signature"), supabaseWebhookStore(db), webhookHandlers(db, provider));
  return NextResponse.json({ result: outcome.result }, { status: outcome.httpStatus });
}
