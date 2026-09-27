import Constants from "expo-constants";

interface Extra {
  client: {
    tenantId: string | null;
    tenantSlug: string | null;
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    supportEmail: string;
    websiteDomain: string;
  };
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
}

export const appConfig = (Constants.expoConfig?.extra ?? {}) as Extra;
/** Branded builds lock to one tenant; the universal app lets users choose. */
export const lockedTenantSlug: string | null = typeof appConfig.client?.tenantSlug === "string" ? appConfig.client.tenantSlug : null;
