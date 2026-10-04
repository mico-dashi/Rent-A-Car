"use client";

import { useEffect, useMemo } from "react";
import { createTranslator } from "@rental/localization";
import { reportClientError } from "@/lib/report-error";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  const t = useMemo(() => createTranslator(typeof document !== "undefined" && document.documentElement.lang === "sq" ? "sq" : "en"), []);
  // Never render the error message or stack: details are in server logs (digest correlates them).
  return (
    <div role="alert" className="mx-auto flex max-w-lg px-5 min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="font-display text-3xl font-black">{t("common.genericError")}</h1>
      <button type="button" onClick={reset} className="btn-primary mt-8">{t("common.retry")}</button>
    </div>
  );
}
