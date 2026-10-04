"use client";

import { useMemo, useState, useTransition } from "react";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import { cancelBooking } from "@/app/actions";

export function CancelBookingButton({ bookingId, version, lang }: { bookingId: string; version: number; lang: LanguageCode }) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-3"
      action={(fd) => {
        if (!window.confirm(t("account.cancelConfirm"))) return;
        start(async () => {
          const res = await cancelBooking(fd);
          if (!res.ok) setError(res.code ?? "INTERNAL_ERROR");
        });
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="version" value={version} />
      <button type="submit" className="btn-ghost border-bad text-bad" disabled={pending}>{pending ? t("common.loading") : t("account.cancelBooking")}</button>
      {error ? <p role="alert" className="mt-2 text-sm text-bad">{t(`errors.${error}`)}</p> : null}
    </form>
  );
}
