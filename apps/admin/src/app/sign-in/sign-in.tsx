"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import { browserClient } from "@/lib/supabase/browser";

/** Staff / owner sign-in. A required second factor is completed at /mfa (see lib/mfa.ts). */
export function SignIn({ lang, next }: { lang: LanguageCode; next: string }) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await browserClient().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    // The dashboards' MFA gate (/mfa) takes over when a second factor is required.
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-8">
      <h1 className="font-display text-2xl font-black">{t("admin.signIn.title")}</h1>
      <div><label className="label" htmlFor="email">{t("auth.email")}</label><input id="email" type="email" className="field" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      <div><label className="label" htmlFor="pw">{t("auth.password")}</label><input id="pw" type="password" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? t("common.loading") : t("auth.signIn")}</button>
      <button type="button" className="w-full text-sm text-muted underline disabled:opacity-50" disabled={busy || !email}
        onClick={async () => {
          const { error } = await browserClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
          setMsg(error ? { ok: false, text: error.message } : { ok: true, text: t("auth.magicLinkSent") });
        }}>{t("auth.magicLink")}</button>
      {msg ? <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p> : null}
    </form>
  );
}
