/**
 * White-label mobile build configuration. One file per client under
 * clients/<slug>/config.ts; selected at build time with APP_VARIANT=<slug>.
 * The universal app (default) is multi-tenant; a branded app locks to one tenant.
 */
export interface ClientConfig {
  /** Tenant UUID for branded apps; null for the universal multi-tenant app. */
  tenantId: string | null;
  /** Tenant slug the branded app locks to (resolved at runtime via resolve_tenant). */
  tenantSlug: string | null;
  appName: string;
  slug: string;
  scheme: string;
  bundleIdentifier: string;
  androidPackage: string;
  icon: string;
  adaptiveIconForeground: string;
  splash: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  supportEmail: string;
  websiteDomain: string;
  /** Hosts for iOS universal links / Android app links (tenant domains that open the app). */
  associatedDomains: string[];
  easProjectId?: string;
}
