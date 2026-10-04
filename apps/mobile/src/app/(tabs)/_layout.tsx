import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useTenant } from "@/lib/tenant";

const glyph = (g: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }} accessibilityElementsHidden>{g}</Text>;

export default function TabsLayout() {
  const { theme, lang } = useTenant();
  const { staffRole } = useAuth();
  const t = useT(lang);
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: theme.primary,
      tabBarInactiveTintColor: theme.textMuted,
      tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
      sceneStyle: { backgroundColor: theme.background },
    }}>
      <Tabs.Screen name="home" options={{ title: t("mobile.tabs.explore"), tabBarIcon: glyph("◎") }} />
      <Tabs.Screen name="bookings" options={{ title: t("mobile.tabs.bookings"), tabBarIcon: glyph("▤") }} />
      <Tabs.Screen name="staff" options={{ title: t("mobile.tabs.staff"), tabBarIcon: glyph("✓"), href: staffRole ? "/staff" : null }} />
      <Tabs.Screen name="account" options={{ title: t("mobile.tabs.account"), tabBarIcon: glyph("○") }} />
    </Tabs>
  );
}
