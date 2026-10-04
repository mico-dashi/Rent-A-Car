import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@rental/auth";
import { ensureCustomer, startIdentityVerification } from "@rental/server";
import { clientIp, handleRouteError, jsonError, rateLimit } from "@/lib/http";
import { paymentProvider } from "@/lib/payments";
import { serviceClient, userClient } from "@/lib/supabase/server";
import { getTenantOrNull } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Start hosted identity verification (ID document + live selfie) for the
 * signed-in customer of this tenant. Returns the provider URL to open, or
 * `{ alreadyVerified: true }`. Images stay with the provider.
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  try {
    if (!await rateLimit(`idv:${clientIp(req)}`, 10, 3_600_000)) return jsonError("RATE_LIMITED");
    const tenant = await getTenantOrNull();
    if (!tenant) return jsonError("TENANT_NOT_ACTIVE", 404);
    const user = await requireUser(await userClient());
    if (!await rateLimit(`idv-user:${user.id}`, 5, 3_600_000)) return jsonError("RATE_LIMITED");
    const provider = paymentProvider();
    if (!provider) return jsonError("PAYMENTS_NOT_CONFIGURED");
    const db = serviceClient();
    const customer = await ensureCustomer(db, tenant.id, user);
    const returnUrl = new URL("/account/privacy?identity=submitted", req.url).toString();
    const res = await startIdentityVerification(db, provider, { customerId: customer.id as string, returnUrl });
    return NextResponse.json(res, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
