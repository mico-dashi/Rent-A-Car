import { getT } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { MfaForm } from "./mfa-form";

/** Second-factor gate for the dashboards (see lib/mfa.ts for the policy). */
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireUser();
  const { t, lang } = await getT();
  const { next } = await searchParams;
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const { data } = await (await userClient()).auth.mfa.listFactors();
  const enrolled = (data?.totp ?? []).some((f) => f.status === "verified");
  return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <div className="card w-full max-w-sm space-y-4 p-8">
        <h1 className="font-display text-2xl font-black">{t("admin.signIn.mfaTitle")}</h1>
        <p className="text-sm text-muted">{enrolled ? t("admin.signIn.mfaChallengeHint") : t("admin.signIn.mfaEnrollHint")}</p>
        <MfaForm lang={lang} mode={enrolled ? "challenge" : "enroll"} next={safe} />
        <form action="/auth/sign-out" method="post"><button className="text-sm text-muted underline">{t("auth.signOut")}</button></form>
      </div>
    </div>
  );
}
