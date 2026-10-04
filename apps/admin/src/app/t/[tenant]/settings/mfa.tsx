import type { LanguageCode } from "@rental/types";
import { createTranslator } from "@rental/localization";
import { MfaForm } from "@/app/mfa/mfa-form";
import { userClient } from "@/lib/supabase/server";

/** TOTP status and enrolment for the signed-in user (server-side session; cookies are httpOnly). */
export async function MfaEnrollment({ lang }: { lang: LanguageCode }) {
  const t = createTranslator(lang);
  const { data } = await (await userClient()).auth.mfa.listFactors();
  if ((data?.totp ?? []).some((f) => f.status === "verified")) return <p className="text-sm text-ok">✓ {t("admin.settings.mfaOn")}</p>;
  return <MfaForm lang={lang} mode="manage" />;
}
