"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTranslator, translateError } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import { startEnrollment, verifyCode } from "./actions";

/** Challenge (already enrolled) or enrol-then-verify, then continue to `next`. */
export function MfaForm({ lang, mode, next }: { lang: LanguageCode; mode: "challenge" | "enroll" | "manage"; next?: string }) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done && mode === "manage") return <p className="text-sm text-ok">✓ {t("admin.settings.mfaOn")}</p>;
  const needsQr = mode !== "challenge" && !enroll;
  return (
    <div className="space-y-3 text-sm">
      {needsQr ? (
        <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={pending} onClick={() => start(async () => {
          const res = await startEnrollment();
          if (!res?.ok || !res.enroll) setError(res?.error ?? "INTERNAL_ERROR");
          else setEnroll(res.enroll);
        })}>{t("admin.settings.mfaEnable")}</button>
      ) : (
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await verifyCode(enroll?.factorId ?? null, code);
            if (!res?.ok) return setError(res?.error ?? "INTERNAL_ERROR");
            setDone(true);
            if (next) { router.replace(next); router.refresh(); }
          });
        }}>
          {enroll ? (
            <>
              <p className="text-muted">{t("admin.settings.mfaQr")}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enroll.qr} alt={t("admin.settings.mfaQr")} className="h-40 w-40 rounded-md bg-white p-2" />
              <p className="break-all font-mono text-xs text-muted">{enroll.secret}</p>
            </>
          ) : null}
          <label className="label" htmlFor="otp">{t("admin.signIn.mfaCode")}</label>
          <div className="flex gap-2">
            <input id="otp" className="field w-36 py-2 tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
            <button className="btn-primary px-4 py-2 text-sm" disabled={pending}>{pending ? t("common.loading") : t("admin.settings.mfaVerify")}</button>
          </div>
        </form>
      )}
      {error ? <p role="alert" className="text-bad">{translateError(lang, error)}</p> : null}
    </div>
  );
}
