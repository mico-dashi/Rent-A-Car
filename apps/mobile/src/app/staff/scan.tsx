import { useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useT } from "@/lib/i18n";
import { tokenFromQr } from "@/lib/qr";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import { Body, Button, ErrorText, H1, Row, Screen } from "@/lib/ui";

/**
 * Scan a vehicle's QR code and open its pickup/return inspection for today.
 * The token is resolved by `vehicle_by_qr`, which only answers staff of the
 * vehicle's own tenant.
 */
export default function Scan() {
  const { tenant, lang } = useTenant();
  const t = useT(lang);
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  async function onScan(data: string) {
    if (handled.current || !tenant) return;
    handled.current = true;
    const token = tokenFromQr(data);
    const { data: hit } = token ? await supabase().rpc("vehicle_by_qr", { p_token: token }) : { data: null };
    const vehicle = hit as { id: string; tenantId: string } | null;
    if (!vehicle || vehicle.tenantId !== tenant.id) { setError(t("mobile.staff.unknownQr")); handled.current = false; return; }
    const { data: b } = await supabase().from("bookings").select("id,status").eq("vehicle_id", vehicle.id)
      .in("status", ["CONFIRMED", "CHECK_IN_PENDING", "READY_FOR_PICKUP", "ACTIVE", "RETURN_DUE"]).order("starts_at").limit(1).maybeSingle();
    if (!b) { setError(t("mobile.staff.noBookingForVehicle")); handled.current = false; return; }
    const kind = b.status === "ACTIVE" || b.status === "RETURN_DUE" ? "RETURN" : "PICKUP";
    router.replace({ pathname: "/staff/inspection/[bookingId]", params: { bookingId: b.id, kind } });
  }

  if (!permission) return <Screen><Body>{t("common.loading")}</Body></Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <H1>{t("mobile.staff.scan")}</H1>
        <Body muted>{t("mobile.staff.cameraWhy")}</Body>
        <Button title={t("mobile.staff.allowCamera")} onPress={requestPermission} />
        <Button title={t("common.back")} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => void onScan(data)} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, gap: 12 }}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Row><Button title={t("common.back")} variant="ghost" onPress={() => router.back()} /></Row>
      </View>
    </View>
  );
}
