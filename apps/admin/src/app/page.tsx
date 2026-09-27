import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n";
import { isPlatformAdmin, myMemberships, requireUser } from "@/lib/session";
import { Badge } from "@/components/ui";

/** Entry: jump straight into the only tenant, or let the user choose. */
export default async function Home() {
  await requireUser();
  const { t } = await getT();
  const [memberships, admin] = await Promise.all([myMemberships(), isPlatformAdmin()]);
  if (memberships.length === 1 && !admin) redirect(`/t/${memberships[0]!.tenant_slug}`);
  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="font-display text-3xl font-black">{t("admin.home.title")}</h1>
      <ul className="mt-8 space-y-3">
        {admin ? (
          <li><Link href="/platform" className="card flex items-center justify-between p-5 hover:border-brand"><span className="font-semibold">{t("admin.home.platform")}</span><Badge>{t("admin.roles.PLATFORM_ADMIN")}</Badge></Link></li>
        ) : null}
        {memberships.map((m) => (
          <li key={m.tenant_id}>
            <Link href={`/t/${m.tenant_slug}`} className="card flex items-center justify-between p-5 hover:border-brand">
              <span className="font-semibold">{m.tenant_name}</span>
              <span className="flex gap-2"><Badge>{t(`admin.roles.${m.role}`)}</Badge>{m.tenant_status !== "ACTIVE" ? <Badge status="PENDING_APPROVAL">{t(`admin.tenantStatus.${m.tenant_status}`)}</Badge> : null}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-10 flex gap-3">
        <Link href="/onboarding" className="btn-primary px-4 py-2 text-sm">{t("admin.home.createBusiness")}</Link>
        <form action="/auth/sign-out" method="post"><button className="btn-ghost px-4 py-2 text-sm">{t("auth.signOut")}</button></form>
      </div>
    </div>
  );
}
