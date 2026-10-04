import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useT } from "@/lib/i18n";
import { useTenant } from "@/lib/tenant";

/** Deep link / universal link / QR entry point: rentalplatform://t/<slug> or https://<domain>/t/<slug>. */
export default function TenantLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { select, theme, lang } = useTenant();
  const t = useT(lang);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!slug) return;
    select({ slug }).then((r) => (r === "ok" ? router.replace("/home") : setFailed(true)));
  }, [slug, select]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {failed ? <Text style={{ color: theme.text }}>{t("mobile.linkInvalid")}</Text> : <ActivityIndicator color={theme.primary} />}
    </View>
  );
}
