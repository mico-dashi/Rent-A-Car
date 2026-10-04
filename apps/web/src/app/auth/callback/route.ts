import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";

/** OAuth / magic-link / email-confirmation landing: exchange the code for a cookie session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/account/bookings";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/account/bookings";
  if (code) {
    const { error } = await (await userClient()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", url.origin));
}
