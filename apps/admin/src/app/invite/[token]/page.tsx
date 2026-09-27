import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getUser } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";

/** Staff invitation landing: sign in (or sign up) with the invited email, then accept. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  const user = await getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  const db = await userClient();
  const { data, error } = await db.rpc("accept_invitation", { p_token: token });
  if (!error && data) {
    const { data: tenant } = await db.from("tenants").select("slug").eq("id", data as unknown as string).single();
    redirect(`/t/${tenant?.slug ?? ""}`);
  }
  return (
    <div className="mx-auto max-w-md px-5 py-20 text-center">
      <h1 className="font-display text-2xl font-black">{t("admin.invite.title")}</h1>
      <p className="mt-3 text-muted" role="alert">{t(`admin.errors.${error?.message ?? "INVITATION_INVALID"}`)}</p>
    </div>
  );
}
