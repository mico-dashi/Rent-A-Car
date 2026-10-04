import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { getT } from "@/lib/i18n";
import { userClient } from "@/lib/supabase/server";
import { DeleteAccountButton } from "./delete-button";
import { VerifyIdentityButton } from "./verify-button";

export const metadata: Metadata = { title: "Privacy & data", robots: { index: false } };

export default async function PrivacyDataPage({ searchParams }: { searchParams: Promise<{ identity?: string }> }) {
  const tenant = await getTenant();
  const { lang, t } = await getT(tenant.language);
  const db = await userClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect("/sign-in?next=/account/privacy");
  const { identity } = await searchParams;
  const { data: me } = await db.from("customers").select("identity_status").eq("tenant_id", tenant.id).eq("user_id", auth.user.id).maybeSingle();
  const idStatus = (me?.identity_status as string | undefined) ?? "UNVERIFIED";
  const { data: open } = await db.from("privacy_requests").select("id").eq("user_id", auth.user.id).eq("kind", "DELETE")
    .in("status", ["REQUESTED", "IN_PROGRESS"]).limit(1);
  return (
    <div className="container-page max-w-2xl pt-12">
      <h1 className="font-display text-3xl font-black">{t("account.privacyTitle")}</h1>
      <section className="card mt-8 p-6">
        <h2 className="font-display text-lg font-bold">{t("account.identityTitle")}</h2>
        <p className="mt-2 text-sm text-muted">{t("account.identityHint")}</p>
        <p className="mt-3 text-sm">{t("admin.common.status")}: <strong>{t(`admin.verification.${idStatus}`)}</strong></p>
        {identity === "submitted" && idStatus !== "VERIFIED" ? <p role="status" className="mt-2 text-sm text-ok">{t("account.identitySubmitted")}</p> : null}
        {idStatus !== "VERIFIED" ? <div className="mt-4"><VerifyIdentityButton lang={lang} /></div> : null}
      </section>
      <section className="card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">{t("account.exportData")}</h2>
        <p className="mt-2 text-sm text-muted">{t("account.exportHint")}</p>
        <a href="/account/export" className="btn-primary mt-4 inline-flex" download>{t("account.exportData")}</a>
      </section>
      <section className="card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">{t("account.deleteAccount")}</h2>
        <p className="mb-4 mt-2 text-sm text-muted">{t("account.deleteHint")}</p>
        <DeleteAccountButton lang={lang} requested={(open ?? []).length > 0} />
      </section>
    </div>
  );
}
