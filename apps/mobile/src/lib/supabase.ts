import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { appConfig } from "./config";
import { secureStorage } from "./secure-storage";

let client: SupabaseClient | null = null;

/** Anon-key client; the user session is persisted in the device keychain/keystore. */
export function supabase(): SupabaseClient {
  if (!appConfig.supabaseUrl || !appConfig.supabaseAnonKey) {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not configured");
  }
  client ??= createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
    auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
