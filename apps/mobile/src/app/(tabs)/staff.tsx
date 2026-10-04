import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text, View, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatDateTime, translateError } from "@rental/localization";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import type { QueuedOp } from "@/lib/offline-queue";
import { queue, syncNow } from "@/lib/queue";
import { todayOperations, type StaffBooking } from "@/lib/staff";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import { Body, Button, Card, ErrorText, H1, H2, Label, Loading, Row } from "@/lib/ui";

export default function StaffTab() {
  const { tenant, theme, lang } = useTenant();
  const { staffRole } = useAuth();
  const t = useT(lang);
  const [data, setData] = useState<{ pickups: StaffBooking[]; returns: StaffBooking[] } | null>(null);
  const [offline, setOffline] = useState(false);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    setSyncing(true);
    const res = await syncNow();
    setSyncing(false);
    setOps(await queue.list());
    try {
      setData(await todayOperations(supabase(), tenant.id, tenant.timezone));
      setOffline(res.offline);
    } catch {
      setOffline(true);
    }
  }, [tenant]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!tenant || !staffRole) return <Loading />;

  const item = (b: StaffBooking, kind: "PICKUP" | "RETURN") => {
    const overdue = kind === "RETURN" && Date.parse(b.ends_at) < Date.now();
    return (
      <Pressable key={`${kind}-${b.id}`} accessibilityRole="button" accessibilityHint={t(kind === "PICKUP" ? "mobile.staff.startPickup" : "mobile.staff.startReturn")}
        onPress={() => router.push({ pathname: "/staff/inspection/[bookingId]", params: { bookingId: b.id, kind } })}
        style={{ backgroundColor: theme.surface, borderColor: overdue ? theme.danger : theme.border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 2 }}>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
          {formatDateTime(kind === "PICKUP" ? b.starts_at : b.ends_at, tenant.timezone, lang, "short")} · {b.reference}{overdue ? ` · ${t("admin.overview.overdue")}` : ""}
        </Text>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>{b.customer}</Text>
        <Text style={{ color: theme.textMuted }}>{b.vehicle} {b.plate ? `· ${b.plate}` : ""}</Text>
      </Pressable>
    );
  };

  const pending = ops.filter((o) => o.state === "pending").length;
  const problems = ops.filter((o) => o.state !== "pending");

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
        refreshControl={<RefreshControl tintColor={theme.primary} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <H1>{t("admin.nav.today")}</H1>
        <Row>
          <View style={{ flex: 1 }}><Button title={t("mobile.staff.scan")} onPress={() => router.push("/staff/scan")} /></View>
          <View style={{ flex: 1 }}><Button title={t("mobile.staff.syncNow")} variant="ghost" busy={syncing} onPress={load} /></View>
        </Row>
        {offline ? <Body muted>{t("common.offline")}</Body> : null}
        {pending ? <Body muted>{t("mobile.staff.pendingSync", { count: pending })}</Body> : null}
        {problems.map((o) => (
          <Card key={o.id} style={{ borderColor: theme.danger }}>
            <Label>{o.state === "conflict" ? t("mobile.staff.conflict") : t("mobile.staff.failed")}</Label>
            <Body>{o.type === "photo" ? t("admin.inspections.photos") : t("mobile.staff.inspection")} · {translateError(lang, o.error)}</Body>
            {o.state === "conflict" ? <Body muted>{t("mobile.staff.conflictHint")}</Body> : null}
            <Row>
              {o.state === "conflict" ? (
                <Button title={t("mobile.staff.keepMine")} variant="ghost" onPress={async () => {
                  await queue.keepMine(o.id, (o.payload as { serverVersion?: number }).serverVersion ?? 0);
                  await load();
                }} />
              ) : null}
              <Button title={t("mobile.staff.discard")} variant="danger" onPress={async () => { await queue.remove(o.id); setOps(await queue.list()); }} />
            </Row>
          </Card>
        ))}
        {data === null ? (offline ? <ErrorText>{t("common.offline")}</ErrorText> : <Loading />) : (
          <>
            <H2>{t("admin.overview.pickups")} ({data.pickups.length})</H2>
            {data.pickups.length ? data.pickups.map((b) => item(b, "PICKUP")) : <Body muted>{t("common.empty")}</Body>}
            <H2>{t("admin.overview.returns")} ({data.returns.length})</H2>
            {data.returns.length ? data.returns.map((b) => item(b, "RETURN")) : <Body muted>{t("common.empty")}</Body>}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
