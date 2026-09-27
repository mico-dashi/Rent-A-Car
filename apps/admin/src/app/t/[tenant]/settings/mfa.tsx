"use client";

import { useEffect, useMemo, useState } from "react";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import { browserClient } from "@/lib/supabase/browser";

/** TOTP enrolment for the signed-in user (owners/admins should enable this). */
export function MfaEnrollment({ lang }: { lang: LanguageCode }) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const [factors, setFactors] = useState<{ id: string; status: string }[] | null>(null);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const { data } = await browserClient().auth.mfa.listFactors();
    setFactors((data?.totp ?? []).map((f) => ({ id: f.id, status: f.status })));
  };
  useEffect(() => { void load(); }, []);

  if (factors === null) return <p className="text-sm text-muted">{t("common.loading")}</p>;
  const verified = factors.some((f) => f.status === "verified");
  if (verified) return <p className="text-sm text-ok">✓ {t("admin.settings.mfaOn")}</p>;
  return (
    <div className="space-y-3 text-sm">
      {!enroll ? (
        <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={async () => {
          const { data, error } = await browserClient().auth.mfa.enroll({ factorType: "totp" });
          if (error) return setMsg(error.message);
          setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
        }}>{t("admin.settings.mfaEnable")}</button>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt={t("admin.settings.mfaQr")} className="h-40 w-40 rounded-md bg-white p-2" />
          <p className="break-all font-mono text-xs text-muted">{enroll.secret}</p>
          <div className="flex gap-2"><input className="field w-32 py-2 tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("admin.signIn.mfaCode")} />
            <button type="button" className="btn-primary px-4 py-2 text-sm" onClick={async () => {
              const { error } = await browserClient().auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
              if (error) return setMsg(error.message);
              setEnroll(null); setMsg(null); await load();
            }}>{t("admin.settings.mfaVerify")}</button></div>
        </>
      )}
      {msg ? <p role="alert" className="text-bad">{msg}</p> : null}
    </div>
  );
}
