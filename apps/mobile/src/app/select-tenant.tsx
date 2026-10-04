import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { nearbyTenants, type NearbyTenant } from "@rental/api-client";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import { useT } from "@/lib/i18n";

/** Universal-app tenant discovery by code. Invite links, QR codes and domain links arrive via /t/[slug]. */
export default function SelectTenant() {
  const { theme, lang, select } = useTenant();
  const t = useT(lang);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyTenant[] | null>(null);
  const [locating, setLocating] = useState(false);

  /** Location is asked for only when the user taps; coarse accuracy is enough and nothing is stored. */
  async function findNearby() {
    setError(null);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { setError(t("mobile.locationDenied")); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setNearby(await nearbyTenants(supabase(), pos.coords.latitude, pos.coords.longitude));
    } catch {
      setError(t("common.genericError"));
    } finally {
      setLocating(false);
    }
  }

  async function choose(slug: string) {
    setBusy(true);
    const res = await select({ slug });
    setBusy(false);
    if (res === "ok") router.replace("/home");
    else setError(t("common.genericError"));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await select({ code: code.trim().toUpperCase() });
    setBusy(false);
    if (res === "ok") router.replace("/home");
    else setError(res === "not_found" ? t("mobile.companyNotFound") : t("common.genericError"));
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: "center", gap: 20 }}>
        <View style={{ width: 6, height: 32, borderRadius: 3, backgroundColor: theme.primary }} />
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 32, fontWeight: "800", letterSpacing: -0.5 }}>{t("mobile.findCompany")}</Text>
        <Text style={{ color: theme.textMuted, fontSize: 16 }}>{t("mobile.findCompanyHint")}</Text>
        <TextInput
          value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={12}
          placeholder="APEX01" placeholderTextColor={theme.textMuted} accessibilityLabel={t("mobile.companyCode")} returnKeyType="go" onSubmitEditing={submit}
          style={{ color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 20, letterSpacing: 4 }}
        />
        {error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy || code.trim().length < 4} onPress={submit}
          style={({ pressed }) => ({ backgroundColor: theme.primaryButton, opacity: busy || code.trim().length < 4 ? 0.5 : pressed ? 0.85 : 1, borderRadius: 14, paddingVertical: 16, alignItems: "center" })}>
          {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={{ color: theme.onPrimary, fontSize: 16, fontWeight: "700" }}>{t("common.continue")}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={locating} onPress={findNearby} hitSlop={8}
          style={{ borderColor: theme.border, borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}>
          {locating ? <ActivityIndicator color={theme.primary} /> : <Text style={{ color: theme.text, fontWeight: "700" }}>{t("mobile.findNearby")}</Text>}
        </Pressable>
        {nearby && nearby.length === 0 ? <Text style={{ color: theme.textMuted }}>{t("mobile.noneNearby")}</Text> : null}
        {(nearby ?? []).map((n) => (
          <Pressable key={n.slug} accessibilityRole="button" onPress={() => choose(n.slug)}
            accessibilityLabel={`${n.display_name}, ${n.branch_name}, ${t("mobile.kmAway", { km: n.distance_km })}`}
            style={{ backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 10, height: 36, borderRadius: 5, backgroundColor: n.primary_color ?? theme.primary }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>{n.display_name}</Text>
              <Text style={{ color: theme.textMuted }}>{n.branch_name}{n.city ? ` · ${n.city}` : ""}</Text>
            </View>
            <Text style={{ color: theme.textMuted }}>{t("mobile.kmAway", { km: n.distance_km })}</Text>
          </Pressable>
        ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
