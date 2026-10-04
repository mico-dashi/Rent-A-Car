"use client";

import { createSupabaseBrowserClient, type SupabaseClient } from "@rental/auth";

let client: SupabaseClient | null = null;
export function browserClient(): SupabaseClient {
  client ??= createSupabaseBrowserClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  });
  return client;
}
