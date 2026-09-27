import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { VEHICLE_STATUSES } from "@rental/types";
import { ActionForm, Field, Hidden, Select, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card, DL, Empty, PageHeader, Table } from "@/components/ui";
import { d, dt, money } from "@/lib/format";
import { getT } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { can, getTenantContext, requirePermission } from "@/lib/session";
import { userClient } from "@/lib/supabase/server";
import { addDocumentAction, deleteDocumentAction, deleteImageAction, makeCoverAction, scheduleTransferAction, setClassAction, setFeaturesAction, setStatusAction, transferStatusAction, updateVehicleAction, uploadImagesAction } from "../actions";
import { VehicleFields } from "../vehicle-form";

const FEATURES = ["navigation", "bluetooth", "apple_carplay", "android_auto", "climate_control", "heated_seats", "sunroof", "parking_sensors", "rear_camera", "cruise_control", "tow_hitch", "child_seat_isofix"];

export default async function VehiclePage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  requirePermission(ctx, "vehicles.read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t, lang } = await getT();
  const db = await userClient();
  const { data: v } = await db.from("vehicles").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!v) notFound();
  const path = `/t/${ctx.slug}/fleet/${id}`;
  const [images, features, docs, history, damages, maint, bookings, classes, member, branches, transfers, drivers] = await Promise.all([
    db.from("vehicle_images").select("*").eq("vehicle_id", id).order("sort_order"),
    db.from("vehicle_features").select("feature").eq("vehicle_id", id),
    db.from("vehicle_documents").select("*").eq("vehicle_id", id).order("expires_on"),
    db.from("vehicle_status_history").select("*").eq("vehicle_id", id).order("created_at", { ascending: false }).limit(20),
    can(ctx, "damages.read") ? db.from("vehicle_damages").select("id,damage_type,location,status,discovered_at").eq("vehicle_id", id).order("discovered_at", { ascending: false }) : Promise.resolve({ data: [] }),
    can(ctx, "maintenance.read") ? db.from("maintenance_records").select("id,type,status,scheduled_start,cost_minor").eq("vehicle_id", id).order("scheduled_start", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    can(ctx, "bookings.read") ? db.from("bookings").select("id,reference,status,starts_at,ends_at").eq("vehicle_id", id).not("status", "in", "(CANCELLED,DRAFT,QUOTE)").order("starts_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    db.from("vehicle_classes").select("id,code,name").eq("tenant_id", ctx.tenantId),
    db.from("vehicle_class_members").select("class_id").eq("vehicle_id", id).maybeSingle(),
    db.from("branches").select("id,name").eq("tenant_id", ctx.tenantId),
    db.from("vehicle_transfers").select("*").eq("vehicle_id", id).order("depart_at", { ascending: false }).limit(5),
    can(ctx, "transfers.manage") ? db.from("memberships").select("id,role,user_id,invited_email").eq("tenant_id", ctx.tenantId).eq("status", "ACTIVE").in("role", ["DRIVER", "EMPLOYEE", "MANAGER"]) : Promise.resolve({ data: [] }),
  ]);
  const scanUrl = `${process.env.NEXT_PUBLIC_ADMIN_URL ?? ""}/t/${ctx.slug}/scan/${v.qr_token}`;
  const qr = await QRCode.toString(scanUrl, { type: "svg", margin: 1, width: 160 });
  const current = (bookings.data ?? []).find((b) => ["ACTIVE", "RETURN_DUE"].includes(b.status));
  const featureSet = new Set((features.data ?? []).map((f) => f.feature));
  const bn = (x: string) => (branches.data ?? []).find((b) => b.id === x)?.name ?? "—";

  return (
    <>
      <PageHeader title={`${v.make} ${v.model}`} subtitle={`${v.registration_plate} · #${v.fleet_number} · ${v.year}`}
        actions={<Badge status={v.status === "AVAILABLE" ? "CONFIRMED" : "PENDING_APPROVAL"}>{t(`admin.vehicleStatus.${v.status}`)}</Badge>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {can(ctx, "vehicles.write") ? (
            <Card title={t("admin.fleet.details")}>
              <ActionForm action={updateVehicleAction} lang={lang} submitLabel={t("admin.common.save")}><TenantFields slug={ctx.slug} path={path} /><Hidden name="vehicleId" value={v.id} /><VehicleFields v={v} branches={branches.data ?? []} lang={lang} /></ActionForm>
            </Card>
          ) : (
            <Card title={t("admin.fleet.details")}><DL items={[[t("admin.fleet.fields.dailyRate"), money(v.daily_rate_minor, ctx.currency, lang)], [t("admin.fleet.fields.odometer"), `${v.odometer_km} km`], [t("admin.fleet.fields.branch"), bn(v.branch_id)]]} /></Card>
          )}

          <Card title={t("admin.fleet.images")}>
            {(images.data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {(images.data ?? []).map((img, i) => (
                  <li key={img.id} className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(img.thumbnail_path ?? img.storage_path) ?? ""} alt={img.alt_text ?? ""} className="aspect-[4/3] w-full rounded-md object-cover" loading="lazy" />
                    {can(ctx, "vehicles.write") ? (
                      <div className="flex gap-2">
                        {i > 0 ? <ActionForm action={makeCoverAction} lang={lang} submitLabel={t("admin.fleet.makeCover")} variant="ghost" className="flex"><TenantFields slug={ctx.slug} path={path} /><Hidden name="vehicleId" value={v.id} /><Hidden name="imageId" value={img.id} /></ActionForm> : <Badge>{t("admin.fleet.cover")}</Badge>}
                        <ActionForm action={deleteImageAction} lang={lang} submitLabel="×" variant="danger" className="flex" confirm={t("admin.common.confirmDelete")}><TenantFields slug={ctx.slug} path={path} /><Hidden name="imageId" value={img.id} /></ActionForm>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {can(ctx, "vehicles.write") ? (
              <ActionForm action={uploadImagesAction} lang={lang} submitLabel={t("admin.inspections.upload")} variant="ghost" className="mt-4 space-y-3" resetOnSuccess>
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="vehicleId" value={v.id} />
                <input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/avif" multiple required aria-label={t("admin.fleet.images")} className="text-sm" />
                <Field label={t("admin.fleet.altText")} name="alt" />
              </ActionForm>
            ) : null}
          </Card>

          <Card title={t("admin.fleet.documents")}>
            {(docs.data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : (
              <Table head={[t("admin.common.type"), t("admin.fleet.reference"), t("admin.fleet.expires"), ""]}>
                {(docs.data ?? []).map((doc) => {
                  const soon = doc.expires_on && doc.expires_on <= new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
                  return (
                    <tr key={doc.id}><td>{t(`admin.fleet.docKinds.${doc.kind}`)}</td><td>{doc.reference_number ?? "—"}</td>
                      <td className={soon ? "text-warn" : ""}>{d(doc.expires_on, ctx.timezone, lang)}{soon ? " ⚠" : ""}</td>
                      <td className="flex gap-2">{doc.storage_path ? <a className="text-brand underline" href={`/t/${ctx.slug}/documents?bucket=vehicle-documents&path=${encodeURIComponent(doc.storage_path)}`}>{t("admin.common.open")}</a> : null}
                        {can(ctx, "vehicles.write") ? <ActionForm action={deleteDocumentAction} lang={lang} submitLabel="×" variant="danger" className="flex" confirm={t("admin.common.confirmDelete")}><TenantFields slug={ctx.slug} path={path} /><Hidden name="documentId" value={doc.id} /></ActionForm> : null}</td></tr>
                  );
                })}
              </Table>
            )}
            {can(ctx, "vehicles.write") ? (
              <ActionForm action={addDocumentAction} lang={lang} submitLabel={t("admin.common.add")} variant="ghost" className="mt-4 space-y-3" resetOnSuccess>
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="vehicleId" value={v.id} />
                <div className="grid gap-3 md:grid-cols-4">
                  <Select label={t("admin.common.type")} name="kind" required options={["REGISTRATION", "INSURANCE", "INSPECTION", "OWNERSHIP", "LEASE", "SERVICE_RECORD", "OTHER"].map((k) => ({ value: k, label: t(`admin.fleet.docKinds.${k}`) }))} />
                  <Field label={t("admin.fleet.reference")} name="reference" />
                  <Field label={t("admin.fleet.issued")} name="issued_on" type="date" />
                  <Field label={t("admin.fleet.expires")} name="expires_on" type="date" />
                </div>
                <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" aria-label={t("admin.fleet.documents")} className="text-sm" />
              </ActionForm>
            ) : null}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t("admin.nav.bookings")}>
              {(bookings.data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : <ul className="space-y-2 text-sm">{(bookings.data ?? []).map((b) => <li key={b.id}><Link className="text-brand hover:underline" href={`/t/${ctx.slug}/bookings/${b.id}`}>{b.reference}</Link> · {dt(b.starts_at, ctx.timezone, lang)} <Badge status={b.status}>{t(`booking.status.${b.status}`)}</Badge></li>)}</ul>}
            </Card>
            <Card title={t("admin.nav.maintenance")}>
              {(maint.data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : <ul className="space-y-2 text-sm">{(maint.data ?? []).map((m) => <li key={m.id}>{t(`admin.maintenance.types.${m.type}`)} · {d(m.scheduled_start, ctx.timezone, lang)} · {t(`admin.maintenance.statuses.${m.status}`)}{m.cost_minor ? ` · ${money(m.cost_minor, ctx.currency, lang)}` : ""}</li>)}</ul>}
              {can(ctx, "maintenance.manage") ? <Link className="mt-3 inline-block text-sm text-brand underline" href={`/t/${ctx.slug}/maintenance?vehicle=${v.id}`}>{t("admin.maintenance.schedule")}</Link> : null}
            </Card>
            <Card title={t("admin.nav.damages")}>
              {(damages.data ?? []).length === 0 ? <Empty>{t("common.empty")}</Empty> : <ul className="space-y-2 text-sm">{(damages.data ?? []).map((x) => <li key={x.id}><Link className="text-brand hover:underline" href={`/t/${ctx.slug}/damages/${x.id}`}>{t(`admin.damages.types.${x.damage_type}`)}</Link> {x.location ?? ""} · {t(`admin.damages.statuses.${x.status}`)}</li>)}</ul>}
            </Card>
            <Card title={t("admin.fleet.statusHistory")}>
              <ul className="space-y-1 text-xs text-muted">{(history.data ?? []).map((h) => <li key={h.id}>{dt(h.created_at, ctx.timezone, lang)} · {h.from_status ? t(`admin.vehicleStatus.${h.from_status}`) : "∅"} → {t(`admin.vehicleStatus.${h.to_status}`)}</li>)}</ul>
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          <Card title={t("admin.fleet.qr")}>
            <div className="mx-auto w-40 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label={t("admin.fleet.qr")} />
            <p className="mt-2 break-all text-center text-xs text-muted">{v.fleet_number} · {v.registration_plate}</p>
          </Card>
          {current ? <Card title={t("admin.fleet.currentBooking")}><Link className="text-brand hover:underline" href={`/t/${ctx.slug}/bookings/${current.id}`}>{current.reference}</Link> · {t("admin.bookings.return")} {dt(current.ends_at, ctx.timezone, lang)}</Card> : null}
          {can(ctx, "vehicles.status") ? (
            <Card title={t("admin.common.status")}>
              <ActionForm action={setStatusAction} lang={lang} submitLabel={t("admin.common.save")}>
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="vehicleId" value={v.id} />
                <Select label={t("admin.common.status")} name="status" required defaultValue={v.status} options={VEHICLE_STATUSES.map((s) => ({ value: s, label: t(`admin.vehicleStatus.${s}`) }))} />
              </ActionForm>
            </Card>
          ) : null}
          {can(ctx, "vehicles.write") ? (
            <>
              <Card title={t("admin.fleet.features")}>
                <ActionForm action={setFeaturesAction} lang={lang} submitLabel={t("admin.common.save")}>
                  <TenantFields slug={ctx.slug} path={path} /><Hidden name="vehicleId" value={v.id} />
                  <div className="grid grid-cols-2 gap-2">{FEATURES.map((f) => <label key={f} className="flex items-center gap-2 text-sm"><input type="checkbox" name="features" value={f} defaultChecked={featureSet.has(f)} className="accent-[var(--color-primary)]" />{t(`vehicle.features.${f}`)}</label>)}</div>
                </ActionForm>
              </Card>
              <Card title={t("admin.fleet.class")}>
                <ActionForm action={setClassAction} lang={lang} submitLabel={t("admin.common.save")}>
                  <TenantFields slug={ctx.slug} path={path} /><Hidden name="vehicleId" value={v.id} />
                  <Select label={t("admin.fleet.class")} name="classId" defaultValue={member.data?.class_id ?? null} options={(classes.data ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
                </ActionForm>
              </Card>
            </>
          ) : null}
          {can(ctx, "transfers.manage") ? (
            <Card title={t("admin.fleet.transfers")}>
              <ul className="mb-3 space-y-2 text-sm">{(transfers.data ?? []).map((tr) => (
                <li key={tr.id}>{bn(tr.from_branch_id)} → {bn(tr.to_branch_id)} · {dt(tr.depart_at, ctx.timezone, lang)} · {t(`admin.fleet.transferStatus.${tr.status}`)}
                  {tr.status === "SCHEDULED" || tr.status === "IN_TRANSIT" ? (
                    <span className="ml-2 inline-flex gap-1">{(tr.status === "SCHEDULED" ? ["IN_TRANSIT", "CANCELLED"] : ["COMPLETED"]).map((s) => (
                      <ActionForm key={s} action={transferStatusAction} lang={lang} submitLabel={t(`admin.fleet.transferStatus.${s}`)} variant="ghost" className="inline-flex"><TenantFields slug={ctx.slug} path={path} /><Hidden name="transferId" value={tr.id} /><Hidden name="status" value={s} /></ActionForm>))}</span>
                  ) : null}</li>))}</ul>
              <ActionForm action={scheduleTransferAction} lang={lang} submitLabel={t("admin.fleet.scheduleTransfer")} variant="ghost">
                <TenantFields slug={ctx.slug} path={path} /><Hidden name="vehicleId" value={v.id} />
                <Select label={t("search.returnLocation")} name="toBranchId" required options={(branches.data ?? []).filter((b) => b.id !== v.branch_id).map((b) => ({ value: b.id, label: b.name }))} />
                <Field label={t("admin.fleet.depart")} name="depart" type="datetime-local" required />
                <Field label={t("admin.fleet.arrive")} name="arrive" type="datetime-local" required />
                <Select label={t("admin.fleet.driver")} name="driverMembershipId" options={(drivers.data ?? []).map((m) => ({ value: m.id, label: `${m.invited_email ?? m.user_id?.slice(0, 8)} (${t(`admin.roles.${m.role}`)})` }))} />
                <TextArea label={t("admin.inspections.notes")} name="notes" rows={2} />
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
