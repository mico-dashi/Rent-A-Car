"use client";

import { useMemo, useState, useTransition } from "react";
import { createTranslator, translateError } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import { requestAccountDeletion } from "@/app/actions";

export function DeleteAccountButton({ lang, requested }: { lang: LanguageCode; requested: boolean }) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ ok: boolean; code?: string } | null>(requested ? { ok: true } : null);
  if (state?.ok) return <p role="status" className="text-sm text-ok">{t("account.deleteRequested")}</p>;
  return (
    <div>
      <button type="button" className="btn-ghost border-bad text-bad" disabled={pending}
        onClick={() => {
          if (!window.confirm(t("account.deleteConfirm"))) return;
          start(async () => setState(await requestAccountDeletion()));
        }}>{pending ? t("common.loading") : t("account.deleteAccount")}</button>
      {state && !state.ok ? <p role="alert" className="mt-2 text-sm text-bad">{translateError(lang, state.code)}</p> : null}
    </div>
  );
}
