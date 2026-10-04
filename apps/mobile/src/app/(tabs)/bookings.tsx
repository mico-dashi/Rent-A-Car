import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { customerTab, type CustomerBookingTab } from "@rental/domain";
import { formatDateTime, formatMoney } from "@rental/localization";
import type { BookingStatus } from "@rental/types";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { myBookings, type MyBookingRow } from "@/lib/my-bookings";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import { Body, Button, Chip, ErrorText, H1, Loading, Row, Screen } from "@/lib/ui";

const TABS: CustomerBookingTab[] = ["UPCOMING", "ACTIVE", "PAST", "CANCELLED"];

export default function BookingsTab() {
  const { tenant, theme, lang } = useTenant();
  const { session, ready } = useAuth();
  const t = useT(lang);
  const [rows, setRows] = useState<MyBookingRow[] | null>(null);
  const [tab, setTab] = useState<CustomerBookingTab>("UPCOMING");
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!tenant || !session) return;
    setError(false);
    try { setRows(await myBookings(supabase(), tenant.id, session.user.id)); } catch { setError(true); }
  }, [tenant, session]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!ready) return <Loading />;
  if (!session) {
    return (
      <Screen>
        <H1>{t("account.bookings")}</H1>
        <Body muted>{t("checkout.signInRequired")}</Body>
        <Button title={t("auth.signIn")} onPress={() => router.push("/sign-in")} />
      </Screen>
    );
  }
  const visible = (rows ?? []).filter((b) => customerTab(b.status as BookingStatus) === tab);
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <FlatList
        data={visible}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        refreshControl={<RefreshControl tintColor={theme.primary} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            <H1>{t("account.bookings")}</H1>
            <Row>{TABS.map((k) => <Chip key={k} label={t(`booking.tabs.${k}`)} selected={k === tab} onPress={() => setTab(k)} />)}</Row>
            {error ? <ErrorText>{t("common.genericError")}</ErrorText> : null}
          </View>
        }
        ListEmptyComponent={rows === null ? <Loading /> : <Body muted>{t("common.empty")}</Body>}
        renderItem={({ item: b }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/booking/[id]", params: { id: b.id } })}
            style={{ backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 4 }}>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>{t("account.reference")} {b.reference} · {t(`booking.status.${b.status}`)}</Text>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: "800" }}>{b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}` : "—"}</Text>
            <Text style={{ color: theme.textMuted }}>{formatDateTime(b.starts_at, b.pickup?.timezone ?? "UTC", lang, "short")} → {formatDateTime(b.ends_at, b.pickup?.timezone ?? "UTC", lang, "short")}</Text>
            <Text style={{ color: theme.text, fontWeight: "700" }}>{formatMoney(b.total_minor, b.currency as never, lang)}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
