import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { resolveTenant } from "@rental/api-client";
import { buildTheme, DEFAULT_BRAND, type SemanticColors } from "@rental/design-tokens";
import type { LanguageCode, ResolvedTenant } from "@rental/types";
import { lockedTenantSlug } from "./config";
import { deviceLanguage } from "./i18n";
import { supabase } from "./supabase";

const STORAGE_KEY = "selected_tenant_slug";

interface TenantState {
  status: "loading" | "ready" | "none" | "error";
  tenant: ResolvedTenant | null;
  theme: SemanticColors;
  lang: LanguageCode;
  /** Resolve by tenant code, slug or custom-domain hostname and persist the choice. */
  select(input: { code?: string; slug?: string; hostname?: string }): Promise<"ok" | "not_found" | "error">;
  clear(): Promise<void>;
  retry(): void;
}

const TenantContext = createContext<TenantState | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TenantState["status"]>("loading");
  const [tenant, setTenant] = useState<ResolvedTenant | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      try {
        const slug = lockedTenantSlug ?? (await SecureStore.getItemAsync(STORAGE_KEY));
        if (!slug) { if (!cancelled) setStatus("none"); return; }
        const t = await resolveTenant(supabase(), { slug });
        if (cancelled) return;
        setTenant(t);
        setStatus(t ? "ready" : "none");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const select = useCallback<TenantState["select"]>(async (input) => {
    try {
      const t = await resolveTenant(supabase(), input);
      if (!t) return "not_found";
      if (lockedTenantSlug && t.slug !== lockedTenantSlug) return "not_found"; // branded apps never switch tenant
      await SecureStore.setItemAsync(STORAGE_KEY, t.slug);
      setTenant(t);
      setStatus("ready");
      return "ok";
    } catch {
      return "error";
    }
  }, []);

  const clear = useCallback(async () => {
    if (lockedTenantSlug) return;
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    setTenant(null);
    setStatus("none");
  }, []);

  const value = useMemo<TenantState>(() => ({
    status, tenant,
    theme: buildTheme(tenant?.branding ?? DEFAULT_BRAND, tenant?.branding.defaultTheme === "light" ? "light" : "dark"),
    lang: deviceLanguage(tenant?.language ?? "en"),
    select, clear, retry: () => setAttempt((a) => a + 1),
  }), [status, tenant, select, clear]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantState {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}
