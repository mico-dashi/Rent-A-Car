import { randomUUID } from "node:crypto";
import { ActionForm, Check, Field, Hidden, Select, TextArea } from "@/components/forms";
import { TenantFields } from "@/components/tenant-hidden";
import { Badge, Card } from "@/components/ui";
import type { LanguageCode } from "@rental/types";
import { createTranslator } from "@rental/localization";
import { reportDamageAction, saveInspectionAction, uploadPhotosAction } from "./operations";

const SLOTS = ["FRONT", "REAR", "DRIVER_SIDE", "PASSENGER_SIDE", "WHEELS", "ROOF", "INTERIOR"] as const;

export interface InspectionRow { id: string; version: number; status: string; odometer_km: number; fuel_level_eighths: number | null; battery_level_pct: number | null; notes: string | null; checklist: unknown; customer_accepted_at: string | null }

export function InspectionSection({ kind, slug, path, bookingId, inspection, photos, isElectric, lang, minOdometer }: {
  kind: "PICKUP" | "RETURN"; slug: string; path: string; bookingId: string; inspection: InspectionRow | null; photos: { slot: string; id: string }[];
  isElectric: boolean; lang: LanguageCode; minOdometer: number;
}) {
  const t = createTranslator(lang);
  const checklist = (inspection?.checklist ?? {}) as Record<string, boolean>;
  const locked = inspection?.status === "SUBMITTED" || inspection?.status === "LOCKED";
  const inspectionId = inspection?.id ?? randomUUID();
  return (
    <Card title={t(`admin.inspections.kinds.${kind}`)} actions={inspection ? <Badge>{inspection.status}</Badge> : null}>
      {locked ? (
        <p className="text-sm text-muted">{inspection!.odometer_km} km · {isElectric ? `${inspection!.battery_level_pct ?? "—"}%` : `${inspection!.fuel_level_eighths ?? "—"}/8`} · {inspection!.notes ?? ""}</p>
      ) : (
        <ActionForm action={saveInspectionAction} lang={lang} submitLabel={t("admin.common.save")}>
          <TenantFields slug={slug} path={path} /><Hidden name="bookingId" value={bookingId} /><Hidden name="kind" value={kind} />
          <Hidden name="inspectionId" value={inspectionId} />{inspection ? <Hidden name="version" value={inspection.version} /> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("admin.inspections.odometer")} name="odometer" type="number" min={minOdometer} required defaultValue={inspection?.odometer_km ?? minOdometer} />
            {isElectric
              ? <Field label={t("admin.inspections.battery")} name="battery" type="number" min={0} max={100} required defaultValue={inspection?.battery_level_pct} />
              : <Select label={t("admin.inspections.fuel")} name="fuel" required defaultValue={inspection?.fuel_level_eighths?.toString() ?? "8"} options={Array.from({ length: 9 }, (_, i) => ({ value: String(i), label: `${i}/8` }))} />}
          </div>
          <fieldset><legend className="label">{t("admin.inspections.checklist")}</legend>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{SLOTS.map((s) => <Check key={s} name={`check_${s}`} label={t(`admin.inspections.slots.${s}`)} defaultChecked={checklist[s]} />)}</div>
          </fieldset>
          <TextArea label={t("admin.inspections.notes")} name="notes" defaultValue={inspection?.notes} rows={2} />
          {kind === "PICKUP" ? <Check name="customerAccepted" label={t("admin.inspections.customerAccepts")} defaultChecked={Boolean(inspection?.customer_accepted_at)} /> : null}
          <Check name="submit" label={t("admin.inspections.submitFinal")} />
        </ActionForm>
      )}
      {inspection ? (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <p className="label">{t("admin.inspections.photos")} ({photos.length})</p>
            <ul className="mb-3 flex flex-wrap gap-1 text-xs text-muted">{SLOTS.map((s) => <li key={s} className={photos.some((p) => p.slot === s) ? "text-ok" : ""}>{photos.some((p) => p.slot === s) ? "✓" : "○"} {t(`admin.inspections.slots.${s}`)}</li>)}</ul>
            <ActionForm action={uploadPhotosAction} lang={lang} submitLabel={t("admin.inspections.upload")} variant="ghost" resetOnSuccess>
              <TenantFields slug={slug} path={path} /><Hidden name="inspectionId" value={inspection.id} />
              <Select label={t("admin.inspections.slot")} name="slot" required options={[...SLOTS, "DAMAGE", "DASHBOARD"].map((s) => ({ value: s, label: t(`admin.inspections.slots.${s}`) }))} />
              <input type="file" name="photos" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" multiple required aria-label={t("admin.inspections.photos")} className="text-sm" />
            </ActionForm>
          </div>
          <div>
            <p className="label">{kind === "PICKUP" ? t("admin.inspections.existingDamage") : t("admin.inspections.newDamage")}</p>
            <ActionForm action={reportDamageAction} lang={lang} submitLabel={t("admin.damages.report")} variant="ghost" resetOnSuccess>
              <TenantFields slug={slug} path={path} /><Hidden name="bookingId" value={bookingId} /><Hidden name="inspectionId" value={inspection.id} />
              {kind === "PICKUP" ? <Hidden name="preExisting" value="on" /> : null}
              <Select label={t("admin.common.type")} name="damageType" required options={["SCRATCH", "DENT", "CRACK", "CHIP", "TEAR", "STAIN", "MISSING_PART", "MECHANICAL", "OTHER"].map((d) => ({ value: d, label: t(`admin.damages.types.${d}`) }))} />
              <Field label={t("admin.damages.location")} name="location" />
              <TextArea label={t("admin.damages.description")} name="description" rows={2} required />
            </ActionForm>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
