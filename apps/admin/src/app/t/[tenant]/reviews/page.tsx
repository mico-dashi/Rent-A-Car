import { ActionForm, Hidden, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { dt } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { replyReviewAction } from "./actions";

const DIMS = ["rating_car", "rating_cleanliness", "rating_service", "rating_pickup", "rating_value"] as const;

export default async function ReviewsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getTenantContext((await params).tenant);
  requirePermission(ctx, "tenant.read");
  const { t, lang } = await getT();
  const db = await userClient();
  const [{ data: reviews }, { data: replies }, { data: vehicles }] = await Promise.all([
    db.from("reviews").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(200),
    db.from("review_replies").select("*").eq("tenant_id", ctx.tenantId),
    db.from("vehicles").select("id,make,model").eq("tenant_id", ctx.tenantId),
  ]);
  const rm = new Map((replies ?? []).map((r) => [r.review_id, r]));
  const vm = new Map((vehicles ?? []).map((v) => [v.id, `${v.make} ${v.model}`]));
  const avg = (k: (typeof DIMS)[number]) => (reviews ?? []).length ? ((reviews ?? []).reduce((a, r) => a + r[k], 0) / (reviews ?? []).length).toFixed(1) : "—";
  return (
    <>
      <PageHeader title={t("admin.nav.reviews")} subtitle={t("admin.reviews.subtitle")} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">{DIMS.map((k) => <Stat key={k} label={t(`admin.reviews.dims.${k}`)} value={avg(k)} />)}</div>
      <div className="space-y-4">
        {(reviews ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (reviews ?? []).map((r) => {
          const reply = rm.get(r.id);
          return (
            <Card key={r.id} title={`★ ${Number(r.rating_overall).toFixed(1)} · ${vm.get(r.vehicle_id) ?? ""}`} actions={<span className="text-xs text-muted">{dt(r.created_at, ctx.timezone, lang)}</span>}>
              {r.body ? <blockquote className="whitespace-pre-line border-l-2 border-line pl-3 text-sm">{r.body}</blockquote> : <p className="text-sm text-muted">{t("admin.reviews.noText")}</p>}
              <p className="mt-2 text-xs text-muted">{DIMS.map((k) => `${t(`admin.reviews.dims.${k}`)} ${r[k]}`).join(" · ")}</p>
              {reply ? <p className="mt-3 rounded-md bg-raised p-3 text-sm"><strong>{t("admin.reviews.yourReply")}:</strong> {reply.body}</p> : null}
              {can(ctx, "reviews.reply") ? (
                <ActionForm action={replyReviewAction} lang={lang} submitLabel={reply ? t("admin.reviews.updateReply") : t("admin.reviews.reply")} variant="ghost" className="mt-3 space-y-2">
                  <TenantFields slug={ctx.slug} /><Hidden name="reviewId" value={r.id} /><TextArea label={t("admin.reviews.reply")} name="body" rows={2} defaultValue={reply?.body} required maxLength={2000} />
                </ActionForm>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
