import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { transitionBooking } from "@rental/api-client";
import { CUSTOMER_CANCELLABLE, quoteCancellation } from "@rental/domain";
import { formatDateTime, formatMoney, translateError } from "@rental/localization";
import { BusinessError, type BookingStatus } from "@rental/types";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { myBookings, type MyBookingRow } from "@/lib/my-bookings";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import { Body, Button, Card, ErrorText, H1, Label, Loading, Row, Screen } from "@/lib/ui";

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tenant, lang } = useTenant();
  const { session } = useAuth();
  const t = useT(lang);
  const [b, setB] = useState<MyBookingRow | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!tenant || !session || !id) return;
    const rows = await myBookings(supabase(), tenant.id, session.user.id, id).catch(() => []);
    setB(rows[0] ?? null);
  }, [tenant, session, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (b === undefined || !tenant) return <Loading />;
  if (b === null) return <Screen><Body>{t("common.empty")}</Body><Button title={t("common.back")} variant="ghost" onPress={() => router.back()} /></Screen>;

  const tz = b.pickup?.timezone ?? tenant.timezone;
  const cancel = quoteCancellation(
    { status: b.status as BookingStatus, startsAt: new Date(b.starts_at), totalMinor: b.total_minor, amountPaidMinor: b.amount_paid_minor, amountRefundedMinor: b.amount_refunded_minor },
    { freeCancellationHours: tenant.freeCancellationHours, lateCancellationFeeBps: tenant.lateCancellationFeeBps },
    new Date(),
  );
  const canCancel = CUSTOMER_CANCELLABLE.includes(b.status as BookingStatus) && cancel.allowed;

  function confirmCancel() {
    const fee = cancel.feeMinor > 0 ? `\n${t("account.cancelFee", { amount: formatMoney(cancel.feeMinor, b!.currency as never, lang) })}` : "";
    Alert.alert(t("account.cancelBooking"), `${t("account.cancelConfirm")}${fee}`, [
      { text: t("common.back"), style: "cancel" },
      {
        text: t("account.cancelBooking"), style: "destructive", onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            // Cutoff, fee and refund amounts are enforced by the server, not this screen.
            await transitionBooking(supabase(), b!.id, "CANCELLED", "CUSTOMER_REQUEST", b!.version);
            await load();
          } catch (e) {
            setError(e instanceof BusinessError ? e.code : "INTERNAL_ERROR");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Row><Button title={`‹ ${t("common.back")}`} variant="ghost" onPress={() => router.back()} /></Row>
      <Label>{t("account.reference")} {b.reference}</Label>
      <H1>{b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}` : "—"}</H1>
      <Body>{t(`booking.status.${b.status}`)}</Body>
      <Card>
        <Label>{t("search.pickupDate")}</Label>
        <Body>{b.pickup?.name}{"\n"}{formatDateTime(b.starts_at, tz, lang)}</Body>
        <Label>{t("search.returnDate")}</Label>
        <Body>{formatDateTime(b.ends_at, tz, lang)}</Body>
      </Card>
      <Card>
        <Row style={{ justifyContent: "space-between" }}><Body>{t("common.total")}</Body><Body>{formatMoney(b.total_minor, b.currency as never, lang)}</Body></Row>
        <Row style={{ justifyContent: "space-between" }}><Body muted>{t("admin.bookings.paid")}</Body><Body muted>{formatMoney(b.amount_paid_minor, b.currency as never, lang)}</Body></Row>
      </Card>
      {canCancel ? (
        <>
          {cancel.feeMinor === 0
            ? <Body muted>{t("booking.freeCancellationUntil", { date: formatDateTime(cancel.freeUntil, tz, lang) })}</Body>
            : <Body muted>{t("account.cancelFee", { amount: formatMoney(cancel.feeMinor, b.currency as never, lang) })}</Body>}
          <Button title={t("account.cancelBooking")} variant="danger" onPress={confirmCancel} busy={busy} />
        </>
      ) : null}
      {error ? <ErrorText>{translateError(lang, error)}</ErrorText> : null}
    </Screen>
  );
}
