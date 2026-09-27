import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { INSPECTION_SLOTS, type InspectionDraft, type PhotoSlot } from "@rental/api-client";
import { translateError } from "@rental/localization";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { enqueueInspection, enqueuePhoto, syncNow } from "@/lib/queue";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import { Body, Button, Card, Chip, ErrorText, Field, H1, H2, Label, Loading, Row, Screen } from "@/lib/ui";

interface Loaded {
  bookingId: string; vehicleId: string; reference: string; vehicle: string; customer: string;
  inspectionId: string; version: number | null; draft: Partial<InspectionDraft>;
}

const draftKey = (bookingId: string, kind: string) => `inspection_draft:${bookingId}:${kind}`;

/**
 * Pickup / return inspection that works offline. The form state is kept on the
 * device and every save goes through the outbox, so a dead zone in a parking
 * garage never loses an inspection; conflicts are surfaced on the Today tab.
 */
export default function InspectionScreen() {
  const { bookingId, kind: kindParam } = useLocalSearchParams<{ bookingId: string; kind: string }>();
  const kind = kindParam === "RETURN" ? "RETURN" : "PICKUP";
  const { tenant, theme, lang } = useTenant();
  const { session } = useAuth();
  const t = useT(lang);
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [odometer, setOdometer] = useState("");
  const [fuel, setFuel] = useState<number | null>(8);
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [accepted, setAccepted] = useState(false);
  const [slot, setSlot] = useState<PhotoSlot>("FRONT");
  const [photos, setPhotos] = useState<{ uri: string; slot: PhotoSlot }[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tenant || !bookingId) return;
    (async () => {
      const cached = await AsyncStorage.getItem(draftKey(bookingId, kind));
      let loaded: Loaded | null = cached ? (JSON.parse(cached) as Loaded) : null;
      try {
        const db = supabase();
        const { data: b } = await db.from("bookings").select("id,reference,vehicle_id,customer_id").eq("id", bookingId).single();
        if (b && b.vehicle_id) {
          const [{ data: v }, { data: c }, { data: insp }] = await Promise.all([
            db.from("vehicles").select("make,model,registration_plate,odometer_km").eq("id", b.vehicle_id).single(),
            db.from("customers").select("first_name,last_name").eq("id", b.customer_id).single(),
            db.from("vehicle_inspections").select("*").eq("booking_id", bookingId).eq("kind", kind).maybeSingle(),
          ]);
          loaded = {
            bookingId, vehicleId: b.vehicle_id, reference: b.reference,
            vehicle: v ? `${v.make} ${v.model} · ${v.registration_plate}` : "—", customer: c ? `${c.first_name} ${c.last_name}` : "—",
            inspectionId: insp?.id ?? loaded?.inspectionId ?? Crypto.randomUUID(),
            version: insp?.version ?? null,
            draft: loaded?.draft ?? (insp ? {
              odometerKm: insp.odometer_km, fuelEighths: insp.fuel_level_eighths, notes: insp.notes, checklist: insp.checklist, customerAccepted: Boolean(insp.customer_accepted_at),
            } : { odometerKm: v?.odometer_km }),
          };
        }
      } catch {
        // Offline: fall back to the cached draft.
      }
      setData(loaded);
      if (loaded) {
        setOdometer(loaded.draft.odometerKm !== undefined && loaded.draft.odometerKm !== null ? String(loaded.draft.odometerKm) : "");
        setFuel(loaded.draft.fuelEighths ?? 8);
        setNotes(loaded.draft.notes ?? "");
        setChecklist((loaded.draft.checklist as Record<string, boolean>) ?? {});
        setAccepted(Boolean(loaded.draft.customerAccepted));
      }
    })();
  }, [tenant, bookingId, kind]);

  if (data === undefined || !tenant || !session) return <Loading />;
  if (data === null) return <Screen><ErrorText>{t("common.offline")}</ErrorText><Button title={t("common.back")} variant="ghost" onPress={() => router.back()} /></Screen>;

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setStatus({ ok: false, text: t("mobile.staff.cameraDenied") }); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    const contentType = asset.mimeType === "image/png" ? "image/png" : asset.mimeType === "image/heic" ? "image/heic" : "image/jpeg";
    await enqueuePhoto({
      id: Crypto.randomUUID(), tenantId: tenant!.id, inspectionId: data!.inspectionId, slot, contentType, capturedAt: new Date().toISOString(), sha256: null, localUri: asset.uri,
    });
    setPhotos((p) => [...p, { uri: asset.uri, slot }]);
  }

  async function save(submit: boolean) {
    const km = Number(odometer);
    if (!Number.isInteger(km) || km < 0) { setStatus({ ok: false, text: translateError(lang, "VALIDATION_FAILED") }); return; }
    if (submit && kind === "PICKUP" && !accepted) { setStatus({ ok: false, text: translateError(lang, "CUSTOMER_ACCEPTANCE_REQUIRED") }); return; }
    setBusy(true);
    const draft: InspectionDraft = {
      id: data!.inspectionId, tenantId: tenant!.id, bookingId: data!.bookingId, vehicleId: data!.vehicleId, kind,
      odometerKm: km, fuelEighths: fuel, batteryPct: null, checklist, notes: notes || null, customerAccepted: accepted, submit,
      performedBy: session!.user.id, performedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(draftKey(data!.bookingId, kind), JSON.stringify({ ...data, draft }));
    // Inspection first, then its photos: the queue preserves order.
    await enqueueInspection(draft, data!.version);
    const res = await syncNow();
    setBusy(false);
    if (res.offline) setStatus({ ok: true, text: t("mobile.staff.savedOffline") });
    else if (res.conflicts || res.failed) setStatus({ ok: false, text: t("mobile.staff.needsAttention") });
    else {
      await AsyncStorage.removeItem(draftKey(data!.bookingId, kind));
      setStatus({ ok: true, text: submit ? t("mobile.staff.submitted") : t("admin.common.saved") });
      if (submit) router.back();
    }
  }

  return (
    <Screen>
      <Row><Button title={`‹ ${t("common.back")}`} variant="ghost" onPress={() => router.back()} /></Row>
      <Label>{t(`admin.inspections.kinds.${kind}`)} · {data.reference}</Label>
      <H1>{data.customer}</H1>
      <Body muted>{data.vehicle}</Body>

      <Card>
        <Field label={t("admin.inspections.odometer")} value={odometer} onChangeText={setOdometer} keyboardType="number-pad" />
        <Label>{t("admin.inspections.fuel")}</Label>
        <Row>{[0, 2, 4, 6, 8].map((f) => <Chip key={f} label={`${f}/8`} selected={fuel === f} onPress={() => setFuel(f)} />)}</Row>
      </Card>

      <Card>
        <H2>{t("admin.inspections.checklist")}</H2>
        {INSPECTION_SLOTS.map((s) => (
          <Row key={s} style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <Body>{t(`admin.inspections.slots.${s}`)}</Body>
            <Switch accessibilityLabel={t(`admin.inspections.slots.${s}`)} value={Boolean(checklist[s])} onValueChange={(v) => setChecklist((c) => ({ ...c, [s]: v }))}
              trackColor={{ true: theme.primary, false: theme.border }} />
          </Row>
        ))}
      </Card>

      <Card>
        <H2>{t("admin.inspections.photos")}</H2>
        <Row>{[...INSPECTION_SLOTS, "DASHBOARD" as const, "DAMAGE" as const].map((s) => <Chip key={s} label={t(`admin.inspections.slots.${s}`)} selected={slot === s} onPress={() => setSlot(s)} />)}</Row>
        <Button title={t("mobile.staff.takePhoto")} variant="ghost" onPress={takePhoto} />
        <Row>{photos.map((p, i) => <View key={i} style={{ width: 72, height: 72, borderRadius: 10, overflow: "hidden" }}><Image source={{ uri: p.uri }} style={{ flex: 1 }} accessibilityLabel={t(`admin.inspections.slots.${p.slot}`)} /></View>)}</Row>
      </Card>

      <Field label={t("admin.inspections.notes")} value={notes} onChangeText={setNotes} multiline style={{ minHeight: 96, textAlignVertical: "top", paddingTop: 12 }} />

      {kind === "PICKUP" ? (
        <Row style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <Body style={{ flex: 1 }}>{t("admin.inspections.customerAccepts")}</Body>
          <Switch accessibilityLabel={t("admin.inspections.customerAccepts")} value={accepted} onValueChange={setAccepted} trackColor={{ true: theme.primary, false: theme.border }} />
        </Row>
      ) : null}

      {status ? (status.ok ? <Body>{status.text}</Body> : <ErrorText>{status.text}</ErrorText>) : null}
      <Button title={t("admin.common.save")} variant="ghost" onPress={() => save(false)} busy={busy} />
      <Button title={t("admin.inspections.submitFinal")} onPress={() => save(true)} busy={busy} />
    </Screen>
  );
}
