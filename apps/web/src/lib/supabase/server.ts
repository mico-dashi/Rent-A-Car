import "server-only";
import { cookies, headers } from "next/headers";
import { createSupabaseServerClient, createServiceRoleClient, type SupabaseClient } from "@rental/auth";
import { createClient } from "@supabase/supabase-js";
import { isProduction, serverEnv } from "../env";

/** Acts as the signed-in user (cookie session on web, Bearer token from mobile). RLS applies. */
export async function userClient(): Promise<SupabaseClient> {
  const env = serverEnv();
  const auth = (await headers()).get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  const store = await cookies();
  return createSupabaseServerClient(
    { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try {
          for (const c of items) store.set(c.name, c.value, c.options);
        } catch {
          // Called from a Server Component: cookies are read-only there; middleware refreshes the session.
        }
      },
    },
    isProduction(),
  );
}

/** Anonymous client for public storefront reads. RLS applies. */
export function publicClient(): SupabaseClient {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * SERVICE ROLE — bypasses RLS. Only for trusted server operations whose
 * authorization has been checked in code (pricing reads, booking creation,
 * payment webhooks). Never pass results to the client without filtering.
 */
export function serviceClient(): SupabaseClient {
  const env = serverEnv();
  return createServiceRoleClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
