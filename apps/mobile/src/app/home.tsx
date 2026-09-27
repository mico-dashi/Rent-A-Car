import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { listCatalog } from "@rental/api-client";
import { formatMoney } from "@rental/localization";
import { VEHICLE_CATEGORIES, type CatalogVehicle, type VehicleCategory } from "@rental/types";
import { appConfig } from "@/lib/config";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";

function thumb(path: string | null): string | null {
  if (!path || path.startsWith("demo/") || !appConfig.supabaseUrl) return null;
  return `${appConfig.supabaseUrl}/storage/v1/render/image/public/vehicle-media/${path}?width=640&quality=70`;
}

export default function Home() {
  const { tenant, theme, lang, clear } = useTenant();
  const t = useT(lang);
  const [items, setItems] = useState<CatalogVehicle[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<VehicleCategory | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    setError(false);
    try {
      setItems(await listCatalog(supabase(), tenant.id, { limit: 60 }));
    } catch {
      setError(true);
    }
  }, [tenant]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => (items ?? []).filter((v) => !category || v.category === category), [items, category]);
  const categories = useMemo(() => VEHICLE_CATEGORIES.filter((c) => items?.some((v) => v.category === c)), [items]);

  if (!tenant) return null;

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <FlatList
        data={visible}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 20, gap: 16 }}
        initialNumToRender={6}
        windowSize={7}
        refreshControl={<RefreshControl tintColor={theme.primary} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.primary, fontSize: 12, fontWeight: "700", letterSpacing: 2 }}>{tenant.displayName.toUpperCase()}</Text>
              <Pressable accessibilityRole="button" onPress={clear} hitSlop={12}><Text style={{ color: theme.textMuted, fontSize: 12 }}>Switch</Text></Pressable>
            </View>
            <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.5 }}>{tenant.branding.headline ?? tenant.displayName}</Text>
            <FlatList
              horizontal data={categories} keyExtractor={(c) => c} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}
              renderItem={({ item }) => {
                const active = item === category;
                return (
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setCategory(active ? null : item)}
                    style={{ borderColor: active ? theme.primary : theme.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
                    <Text style={{ color: theme.text, fontWeight: "600", fontSize: 13 }}>{t(`category.${item}`)}</Text>
                  </Pressable>
                );
              }}
            />
          </View>
        }
        ListEmptyComponent={
          items === null && !error ? <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
            : error ? (
              <View style={{ alignItems: "center", gap: 12, marginTop: 40 }}>
                <Text style={{ color: theme.text }}>{t("common.genericError")}</Text>
                <Pressable accessibilityRole="button" onPress={load}><Text style={{ color: theme.primary, fontWeight: "700" }}>{t("common.retry")}</Text></Pressable>
              </View>
            ) : <Text style={{ color: theme.textMuted, textAlign: "center", marginTop: 40 }}>{t("common.empty")}</Text>
        }
        renderItem={({ item: v }) => {
          const src = thumb(v.thumbnail_path);
          return (
            <View accessible accessibilityLabel={`${v.make} ${v.model}`} style={{ backgroundColor: theme.surface, borderRadius: 20, overflow: "hidden", borderColor: theme.border, borderWidth: 1 }}>
              <View style={{ aspectRatio: 16 / 10, backgroundColor: theme.surfaceRaised }}>
                {src ? <Image source={{ uri: src }} style={{ flex: 1 }} contentFit="cover" transition={200} /> : null}
              </View>
              <View style={{ padding: 16, gap: 6 }}>
                <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.5 }}>{t(`category.${v.category}`).toUpperCase()}</Text>
                <Text style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>{v.make} {v.model}</Text>
                <Text style={{ color: theme.textMuted }}>{t(`vehicle.transmission.${v.transmission}`)} · {t("vehicle.seats", { count: v.seats })}</Text>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginTop: 6 }}>
                  {formatMoney(v.daily_rate_minor, v.currency, lang, { compact: true })}<Text style={{ color: theme.textMuted, fontSize: 13, fontWeight: "400" }}> / {t("common.perDay")}</Text>
                </Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
