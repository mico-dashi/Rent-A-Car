import { ActionForm, Hidden } from "@/components/forms";
import { Badge, Card, Empty, PageHeader, Table } from "@/components/ui";
import { dt } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { userClient } from "@/lib/supabase/server";
import { anonymizeAction, privacyStatusAction } from "../actions";

export default async function PrivacyPage() {
  const { t, lang } = await getT();
  const { data } = await (await userClient()).from("privacy_requests").select("*").order("created_at", { ascending: false }).limit(200);
  return (
    <>
      <PageHeader title={t("admin.platform.nav.privacy")} subtitle={t("admin.platform.privacyHint")} />
      <Card>
        {(data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
          <Table head={[t("admin.common.date"), t("admin.common.type"), "User", t("admin.common.status"), ""]}>
            {(data ?? []).map((r) => (
              <tr key={r.id}><td className="text-xs">{dt(r.created_at, "UTC", lang)}</td><td>{r.kind}</td><td className="font-mono text-xs">{r.user_id}</td><td><Badge>{r.status}</Badge></td>
                <td className="flex flex-wrap gap-1">{r.status !== "COMPLETED" && r.kind === "DELETE" ? <ActionForm action={anonymizeAction} lang={lang} submitLabel={t("admin.platform.anonymize")} variant="danger" className="inline-flex" confirm={t("admin.platform.anonymizeConfirm")}><Hidden name="userId" value={r.user_id} /><Hidden name="requestId" value={r.id} /></ActionForm> : null}
                  {r.status === "REQUESTED" ? <ActionForm action={privacyStatusAction} lang={lang} submitLabel={t("admin.platform.markInProgress")} variant="ghost" className="inline-flex"><Hidden name="requestId" value={r.id} /><Hidden name="status" value="IN_PROGRESS" /></ActionForm> : null}
                  {r.kind === "EXPORT" && r.status !== "COMPLETED" ? <ActionForm action={privacyStatusAction} lang={lang} submitLabel={t("admin.platform.markDone")} variant="ghost" className="inline-flex"><Hidden name="requestId" value={r.id} /><Hidden name="status" value="COMPLETED" /></ActionForm> : null}</td></tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
