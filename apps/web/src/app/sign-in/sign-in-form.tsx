"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import { browserClient } from "@/lib/supabase/browser";

type Mode = "signIn" | "signUp";

export function SignInForm({ lang, next }: { lang: LanguageCode; next: string }) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function run(fn: () => Promise<{ error: { message: string } | null }>, success?: string) {
    setBusy(true);
    setMessage(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setMessage({ kind: "error", text: error.message });
    else if (success) setMessage({ kind: "ok", text: success });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sb = browserClient();
    if (mode === "signIn") {
      await run(async () => {
        const res = await sb.auth.signInWithPassword({ email, password });
        if (!res.error) { router.replace(next); router.refresh(); }
        return res;
      });
    } else {
      await run(() => sb.auth.signUp({ email, password, options: { emailRedirectTo: callback(), data: { first_name: firstName, last_name: lastName } } }), t("auth.confirmEmail"));
    }
  }

  return (
    <div className="card w-full max-w-md p-8">
      <h1 className="font-display text-2xl font-black">{mode === "signIn" ? t("auth.signInTitle") : t("auth.signUpTitle")}</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {mode === "signUp" ? (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="fn">{t("auth.firstName")}</label><input id="fn" className="field" required autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
            <div><label className="label" htmlFor="ln">{t("auth.lastName")}</label><input id="ln" className="field" required autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          </div>
        ) : null}
        <div><label className="label" htmlFor="email">{t("auth.email")}</label><input id="email" type="email" className="field" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label" htmlFor="pw">{t("auth.password")}</label><input id="pw" type="password" className="field" required minLength={10} autoComplete={mode === "signIn" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className="btn-primary w-full" disabled={busy} type="submit">{busy ? t("common.loading") : mode === "signIn" ? t("auth.signIn") : t("auth.signUp")}</button>
      </form>
      <button type="button" className="mt-3 w-full text-sm text-muted underline disabled:opacity-50" disabled={busy || !email}
        onClick={() => run(() => browserClient().auth.signInWithOtp({ email, options: { emailRedirectTo: callback(), shouldCreateUser: true } }), t("auth.magicLinkSent"))}>
        {t("auth.magicLink")}
      </button>
      <p className="my-5 text-center text-xs uppercase tracking-widest text-muted">{t("auth.orContinueWith")}</p>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(() => browserClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback() } }))}>{t("auth.google")}</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(() => browserClient().auth.signInWithOAuth({ provider: "apple", options: { redirectTo: callback() } }))}>{t("auth.apple")}</button>
      </div>
      {message ? <p role={message.kind === "error" ? "alert" : "status"} className={`mt-5 text-sm ${message.kind === "error" ? "text-bad" : "text-ok"}`}>{message.text}</p> : null}
      <p className="mt-6 text-center text-sm text-muted">
        {mode === "signIn" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
        <button type="button" className="font-semibold text-brand" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
          {mode === "signIn" ? t("auth.signUp") : t("auth.signIn")}
        </button>
      </p>
    </div>
  );
}
