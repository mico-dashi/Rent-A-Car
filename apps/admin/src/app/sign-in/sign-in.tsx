"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import { browserClient } from "@/lib/supabase/browser";

/** Staff / owner sign-in. Owners and admins with MFA enrolled complete a TOTP challenge. */
export function SignIn({ lang, next }: { lang: LanguageCode; next: string }) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function afterPassword() {
    const sb = browserClient();
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data: factors } = await sb.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (totp) { setFactorId(totp.id); return; }
    }
    router.replace(next);
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = browserClient();
    if (factorId) {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
      setBusy(false);
      if (error) return setMsg({ ok: false, text: error.message });
      router.replace(next);
      return router.refresh();
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    await afterPassword();
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-8">
      <h1 className="font-display text-2xl font-black">{t("admin.signIn.title")}</h1>
      {factorId ? (
        <div><label className="label" htmlFor="otp">{t("admin.signIn.mfaCode")}</label>
          <input id="otp" className="field tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required /></div>
      ) : (
        <>
          <div><label className="label" htmlFor="email">{t("auth.email")}</label><input id="email" type="email" className="field" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><label className="label" htmlFor="pw">{t("auth.password")}</label><input id="pw" type="password" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        </>
      )}
      <button className="btn-primary w-full" disabled={busy}>{busy ? t("common.loading") : t("auth.signIn")}</button>
      {!factorId ? (
        <button type="button" className="w-full text-sm text-muted underline disabled:opacity-50" disabled={busy || !email}
          onClick={async () => {
            const { error } = await browserClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
            setMsg(error ? { ok: false, text: error.message } : { ok: true, text: t("auth.magicLinkSent") });
          }}>{t("auth.magicLink")}</button>
      ) : null}
      {msg ? <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p> : null}
    </form>
  );
}
