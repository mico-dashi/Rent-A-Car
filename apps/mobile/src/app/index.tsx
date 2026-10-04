import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useTenant } from "@/lib/tenant";
import { useT } from "@/lib/i18n";

export default function Index() {
  const { status, theme, lang, retry } = useTenant();
  const t = useT(lang);
  if (status === "loading") {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={theme.primary} accessibilityLabel={t("common.loading")} /></View>;
  }
  if (status === "error") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
        <Text style={{ color: theme.text, fontSize: 16, textAlign: "center" }}>{t("common.genericError")}</Text>
        <Pressable accessibilityRole="button" onPress={retry} style={{ backgroundColor: theme.primaryButton, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 }}>
          <Text style={{ color: theme.onPrimary, fontWeight: "700" }}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }
  return <Redirect href={status === "ready" ? "/home" : "/select-tenant"} />;
}
