import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { useTenant } from "./tenant";

export type StaffRole = "TENANT_OWNER" | "TENANT_ADMIN" | "MANAGER" | "EMPLOYEE" | "DRIVER";

interface AuthState {
  ready: boolean;
  session: Session | null;
  /** Active staff membership in the current tenant (drives staff mode). RLS re-checks every call. */
  staffRole: StaffRole | null;
  signIn(email: string, password: string): Promise<string | null>;
  signUp(input: { email: string; password: string; firstName: string; lastName: string }): Promise<string | null>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { tenant } = useTenant();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);

  useEffect(() => {
    let alive = true;
    supabase().auth.getSession().then(({ data }) => { if (alive) { setSession(data.session); setReady(true); } }).catch(() => setReady(true));
    const { data } = supabase().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !tenant) { setStaffRole(null); return; }
    let alive = true;
    supabase().from("memberships").select("role").eq("tenant_id", tenant.id).eq("user_id", userId).eq("status", "ACTIVE").maybeSingle()
      .then(({ data }) => { if (alive) setStaffRole(((data as { role: StaffRole } | null)?.role) ?? null); });
    return () => { alive = false; };
  }, [session?.user.id, tenant]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    return error ? error.message : null;
  }, []);

  const signUp = useCallback<AuthState["signUp"]>(async ({ email, password, firstName, lastName }) => {
    const { error } = await supabase().auth.signUp({ email: email.trim(), password, options: { data: { first_name: firstName, last_name: lastName } } });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => { await supabase().auth.signOut(); }, []);

  const value = useMemo(() => ({ ready, session, staffRole, signIn, signUp, signOut }), [ready, session, staffRole, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
