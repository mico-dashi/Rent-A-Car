import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/** Scheduled job (e.g. every minute): release expired unpaid holds. */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await serviceClient().rpc("release_expired_holds", { p_vehicle: null });
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  return NextResponse.json({ released: data });
}
