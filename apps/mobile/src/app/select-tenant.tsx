import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTenant } from "@/lib/tenant";
import { useT } from "@/lib/i18n";

/** Universal-app tenant discovery by code. Invite links, QR codes and domain links arrive via /t/[slug]. */
export default function SelectTenant() {
  const { theme, lang, select } = useTenant();
  const t = useT(lang);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, padding: 24, justifyContent: "center", gap: 20 }}>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
