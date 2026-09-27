import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GDPR data export: everything the signed-in user's account holds, as JSON. */
export async function GET() {
  const db = await userClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401 });
  const { data, error } = await db.rpc("export_my_data");
  if (error) return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
