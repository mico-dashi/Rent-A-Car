"use client";

import { useMemo, useState } from "react";
import { createTranslator, translateError } from "@rental/localization";
import type { LanguageCode } from "@rental/types";

/** Starts hosted identity verification and sends the customer to the provider's page. */
export function VerifyIdentityButton({ lang }: { lang: LanguageCode }) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button type="button" className="btn-primary" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        const res = await fetch("/api/v1/identity/session", { method: "POST" });
        const body = (await res.json().catch(() => null)) as { url?: string; alreadyVerified?: boolean; error?: { code: string } } | null;
        if (res.ok && body?.url) { window.location.assign(body.url); return; }
        if (res.ok && body?.alreadyVerified) { window.location.reload(); return; }
        setBusy(false);
        setError(body?.error?.code ?? "INTERNAL_ERROR");
      }}>{busy ? t("common.loading") : t("account.verifyIdentity")}</button>
      {error ? <p role="alert" className="mt-2 text-sm text-bad">{translateError(lang, error)}</p> : null}
    </div>
  );
}
