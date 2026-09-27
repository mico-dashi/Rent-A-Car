import Link from "next/link";
import { Badge, Card, Empty, PageHeader, Table } from "@/components/ui";
import { dt, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { userClient } from "@/lib/supabase/server";

export default async function SystemPage() {
  const { t, lang } = await getT();
  const db = await userClient();
  const [{ data: hooks }, { data: pays }, { data: notes }] = await Promise.all([
    db.from("webhook_events").select("id,provider,event_type,status,attempts,last_error,received_at").in("status", ["FAILED", "RECEIVED", "PROCESSING"]).order("received_at", { ascending: false }).limit(100),
    db.from("payments").select("id,tenant_id,booking_id,amount_minor,currency,failure_code,failure_message,created_at").eq("status", "FAILED").order("created_at", { ascending: false }).limit(100),
    db.from("notifications").select("id,tenant_id,event,channel,error,attempts,created_at").eq("status", "FAILED").order("created_at", { ascending: false }).limit(100),
  ]);
  const tIds = [...new Set([...(pays ?? []).map((p) => p.tenant_id), ...(notes ?? []).map((n) => n.tenant_id)].filter(Boolean))] as string[];
  const { data: tenants } = tIds.length ? await db.from("tenants").select("id,display_name").in("id", tIds) : { data: [] };
  const tn = new Map((tenants ?? []).map((x) => [x.id, x.display_name]));
  return (
    <>
      <PageHeader title={t("admin.platform.nav.system")} subtitle={t("admin.platform.systemHint")} />
      <div className="space-y-6">
        <Card title={t("admin.platform.webhooks")}>{(hooks ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : <Table head={[t("admin.common.date"), "Provider", t("admin.common.type"), t("admin.common.status"), t("admin.platform.attempts"), t("admin.platform.error")]}>
          {(hooks ?? []).map((h) => <tr key={h.id}><td className="text-xs">{dt(h.received_at, "UTC", lang)}</td><td>{h.provider}</td><td className="text-xs">{h.event_type}</td><td><Badge status={h.status === "FAILED" ? "CANCELLED" : "PENDING_APPROVAL"}>{h.status}</Badge></td><td>{h.attempts}</td><td className="text-xs text-bad">{h.last_error}</td></tr>)}</Table>}</Card>
        <Card title={t("admin.platform.failedPayments")}>{(pays ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : <Table head={[t("admin.common.date"), t("admin.platform.tenant"), t("admin.common.amount"), t("admin.platform.error")]}>
          {(pays ?? []).map((p) => <tr key={p.id}><td className="text-xs">{dt(p.created_at, "UTC", lang)}</td><td>{tn.get(p.tenant_id)}</td><td>{money(p.amount_minor, p.currency as "EUR", lang)}</td><td className="text-xs text-bad">{p.failure_code} {p.failure_message}</td></tr>)}</Table>}</Card>
        <Card title={t("admin.platform.failedNotifications")}>{(notes ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : <Table head={[t("admin.common.date"), t("admin.platform.tenant"), t("admin.settings.event"), t("admin.settings.channel"), t("admin.platform.error")]}>
          {(notes ?? []).map((n) => <tr key={n.id}><td className="text-xs">{dt(n.created_at, "UTC", lang)}</td><td>{n.tenant_id ? tn.get(n.tenant_id) : "—"}</td><td className="text-xs">{n.event}</td><td>{n.channel}</td><td className="text-xs text-bad">{n.error}</td></tr>)}</Table>}</Card>
        <p className="text-xs text-muted">{t("admin.platform.sentryHint")} <Link className="underline" href="/platform/audit">{t("admin.platform.nav.audit")}</Link></p>
      </div>
    </>
  );
}
