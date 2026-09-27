import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@rental/database";
import { isProduction, serverEnv } from "../env";

export type Db = SupabaseClient<Database>;

/** The signed-in staff member / admin. RLS applies to every query. */
export async function userClient(): Promise<Db> {
  const env = serverEnv();
  const store = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          for (const c of items) store.set(c.name, c.value, { ...c.options, httpOnly: true, sameSite: "lax", secure: isProduction() });
        } catch {
          // read-only in Server Components; middleware refreshes the session
        }
      },
    },
  });
}

/**
 * SERVICE ROLE — bypasses RLS. Use only after an explicit permission check in
 * the calling action, for operations RLS deliberately does not grant to API
 * users (booking creation/modification, PDF generation, private uploads,
 * payment-provider calls).
 */
export function serviceClient(): Db {
  const env = serverEnv();
  if (typeof window !== "undefined") throw new Error("service client in browser");
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
