import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron";
import { serviceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Scheduled job (e.g. every minute): release expired unpaid holds. */
async function handler(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await serviceClient().rpc("release_expired_holds", { p_vehicle: null });
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  return NextResponse.json({ released: data });
}
export { handler as GET, handler as POST };
