import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  await (await userClient()).auth.signOut();
  return NextResponse.redirect(new URL("/sign-in", req.url), { status: 303 });
}
