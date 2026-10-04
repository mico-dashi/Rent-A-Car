import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@rental/auth";
import { createBookingRequestSchema } from "@rental/validation";
import { createCustomerBooking } from "@rental/server";
import { clientIp, handleRouteError, jsonError, rateLimit } from "@/lib/http";
import { paymentProvider } from "@/lib/payments";
import { serviceClient, userClient } from "@/lib/supabase/server";
import { getTenantOrNull } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = randomUUID();
  try {
    if (!await rateLimit(`book:${clientIp(req)}`, 10, 60_000)) return jsonError("RATE_LIMITED");
    const tenant = await getTenantOrNull();
    if (!tenant) return jsonError("TENANT_NOT_ACTIVE", 404);
    const user = await requireUser(await userClient()); // validates JWT with Supabase Auth
    if (!await rateLimit(`book-user:${user.id}`, 5, 60_000)) return jsonError("RATE_LIMITED");
    const body = createBookingRequestSchema.parse(await req.json());
    if (body.tenantId !== tenant.id) return jsonError("TENANT_MISMATCH", 400);

    const { booking, payment } = await createCustomerBooking(serviceClient(), paymentProvider(), tenant.id, user, body);
    return NextResponse.json({
      id: booking.id, reference: booking.reference, status: booking.status, holdExpiresAt: booking.hold_expires_at ?? null,
      payment: payment ? { clientSecret: payment.clientSecret, stripeAccount: payment.stripeAccount } : null,
    }, { status: booking.replayed ? 200 : 201, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
