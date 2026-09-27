import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { quoteRequestSchema } from "@rental/validation";
import { buildQuote } from "@/lib/pricing-context";
import { clientIp, handleRouteError, jsonError, rateLimit } from "@/lib/http";
import { serviceClient } from "@/lib/supabase/server";
import { getTenantOrNull } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = randomUUID();
  try {
    if (!rateLimit(`quote:${clientIp(req)}`, 60, 60_000)) return jsonError("RATE_LIMITED");
    const tenant = await getTenantOrNull();
    if (!tenant) return jsonError("TENANT_NOT_ACTIVE", 404);
    const body = quoteRequestSchema.parse(await req.json());
    if (body.tenantId !== tenant.id) return jsonError("TENANT_MISMATCH", 400);
    const { quote } = await buildQuote(serviceClient(), tenant.id, body);
    return NextResponse.json({
      currency: quote.currency, days: quote.days, lines: quote.lines, totalMinor: quote.totalMinor, depositMinor: quote.depositMinor,
      dueNowMinor: quote.dueNowMinor, dueLaterMinor: quote.dueLaterMinor, taxMinor: quote.taxMinor, includedKm: quote.includedKm,
    }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
