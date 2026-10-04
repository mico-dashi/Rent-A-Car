import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { buildCsp, createNonce } from "@rental/config/csp";

/**
 * Refreshes the Supabase session cookie on navigation (standard @supabase/ssr
 * pattern) so Server Components always see a valid session. Tenant resolution
 * happens server-side from the Host header (see lib/tenant.ts).
 */
export async function middleware(request: NextRequest) {
  // Per-request CSP nonce: Next.js reads it from the request header and stamps it on its scripts.
  const nonce = createNonce();
  const csp = buildCsp({ nonce, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", isDev: process.env.NODE_ENV !== "production", allowStripeFrames: false });
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);
  const withCsp = (r: NextResponse) => { r.headers.set("content-security-policy", csp); return r; };

  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return withCsp(response);

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value } of items) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of items) {
          response.cookies.set(name, value, { ...options, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
        }
      },
    },
  });
  await supabase.auth.getUser();
  return withCsp(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
