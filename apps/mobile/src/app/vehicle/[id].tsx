import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import { getCatalogVehicle, listBranches, listVehicleImages, type Branch, type QuoteResponse } from "@rental/api-client";
import { formatMoney, priceLineLabel, translateError } from "@rental/localization";
import { BusinessError, type CatalogVehicle } from "@rental/types";
import { DateStepper } from "@/components/date-stepper";
import { httpApi, tenantOrigin } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { appConfig } from "@/lib/config";
import { defaultWindow, toUtcIso } from "@/lib/datetime";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import { Body, Button, Card, Chip, ErrorText, H1, H2, Label, Loading, Row, Screen } from "@/lib/ui";

function publicImage(path: string): string | null {
  if (!appConfig.supabaseUrl || path.startsWith("demo/")) return null;
  return `${appConfig.supabaseUrl}/storage/v1/render/image/public/vehicle-media/${path}?width=1200&quality=75`;
}

export default function VehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tenant, theme, lang } = useTenant();
  const { session } = useAuth();
  const t = useT(lang);
  const [vehicle, setVehicle] = useState<CatalogVehicle | null | undefined>(undefined);
  const [images, setImages] = useState<{ storage_path: string; alt_text: string | null }[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pickup, setPickup] = useState<string | null>(null);
  const [ret, setRet] = useState<string | null>(null);
  const tz = branches.find((b) => b.id === pickup)?.timezone ?? tenant?.timezone ?? "UTC";
  const [window, setWindow] = useState(() => defaultWindow(tenant?.timezone ?? "UTC"));
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef(Crypto.randomUUID());

  useEffect(() => {
    if (!tenant || !id) return;
    const db = supabase();
    Promise.all([getCatalogVehicle(db, tenant.id, id), listBranches(db, tenant.id), listVehicleImages(db, id)])
      .then(([v, b, imgs]) => {
        setVehicle(v);
        setBranches(b);
        setImages(imgs);
        const home = v?.branch_id && b.some((x) => x.id === v.branch_id) ? v.branch_id : b[0]?.id ?? null;
        setPickup(home);
        setRet(home);
      })
      .catch(() => setVehicle(null));
  }, [tenant, id]);

  const request = useMemo(() => {
    if (!tenant || !vehicle || !pickup) return null;
    return {
      tenantId: tenant.id, vehicleId: vehicle.id, pickupBranchId: pickup, returnBranchId: ret ?? pickup,
      startsAt: toUtcIso(window.start, tz), endsAt: toUtcIso(window.end, tz), pickupType: "BRANCH" as const, additionalDrivers: 0, extras: [],
    };
  }, [tenant, vehicle, pickup, ret, window, tz]);

  useEffect(() => {
    if (!request || !tenant) return;
    const api = httpApi(tenant);
    if (!api) { setError("PAYMENTS_NOT_CONFIGURED"); return; }
    let alive = true;
    setError(null);
    const handle = setTimeout(() => {
      api.quote(request).then((q) => alive && setQuote(q)).catch((e) => {
        if (!alive) return;
        setQuote(null);
        setError(e instanceof BusinessError ? e.code : "INTERNAL_ERROR");
      });
    }, 300);
    return () => { alive = false; clearTimeout(handle); };
  }, [request, tenant]);

  if (vehicle === undefined || !tenant) return <Loading />;
  if (vehicle === null) return <Screen><Body>{t("common.empty")}</Body><Button title={t("common.back")} variant="ghost" onPress={() => router.back()} /></Screen>;

  async function book() {
    if (!request || !tenant) return;
    if (!session) { router.push({ pathname: "/sign-in", params: { next: `/vehicle/${vehicle!.id}` } }); return; }
    setBusy(true);
    setError(null);
    try {
      if (tenant.paymentTiming === "PAY_AT_PICKUP") {
        // Nothing to pay now: create the booking natively (server prices it again and holds the car).
        const api = httpApi(tenant)!;
        const res = await api.createBooking({ ...request, idempotencyKey: idempotencyKey.current, acceptedTermsVersion: "1" });
        router.replace({ pathname: "/booking/[id]", params: { id: res.id } });
      } else {
        // Card payments and deposits are collected by the tenant's secure web checkout (Stripe), opened in-app.
        const origin = tenantOrigin(tenant);
        const qs = new URLSearchParams({ vehicle: vehicle!.id, pickup: request.pickupBranchId, return: request.returnBranchId, start: window.start, end: window.end });
        await WebBrowser.openBrowserAsync(`${origin}/checkout?${qs}`, { controlsColor: theme.primary, dismissButtonStyle: "close" });
        router.replace("/bookings");
      }
    } catch (e) {
      setError(e instanceof BusinessError ? e.code : "INTERNAL_ERROR");
    } finally {
      setBusy(false);
    }
  }

  const hero = images[0] ? publicImage(images[0].storage_path) : null;
  return (
    <Screen>
      <Row><Button title={`‹ ${t("common.back")}`} variant="ghost" onPress={() => router.back()} /></Row>
      <View style={{ aspectRatio: 16 / 10, borderRadius: 20, overflow: "hidden", backgroundColor: theme.surfaceRaised }}>
        {hero ? <Image source={{ uri: hero }} style={{ flex: 1 }} contentFit="cover" accessibilityLabel={images[0]?.alt_text ?? `${vehicle.make} ${vehicle.model}`} /> : null}
      </View>
      <Label>{t(`category.${vehicle.category}`)}</Label>
      <H1>{vehicle.make} {vehicle.model}</H1>
      <Body muted>
        {t(`vehicle.transmission.${vehicle.transmission}`)} · {t(`vehicle.fuel.${vehicle.fuel_type}`)} · {t("vehicle.seats", { count: vehicle.seats })}
      </Body>
      <Body>{formatMoney(vehicle.daily_rate_minor, vehicle.currency, lang, { compact: true })} / {t("common.perDay")}</Body>

      <Card>
        <H2>{t("mobile.when")}</H2>
        <DateStepper label={t("search.pickupDate")} value={window.start} timeZone={tz} lang={lang} prevLabel={t("mobile.previousDay")} nextLabel={t("mobile.nextDay")}
          onChange={(start) => setWindow((w) => ({ start, end: w.end <= start ? start.slice(0, 11) + w.end.slice(11) : w.end }))} />
        <DateStepper label={t("search.returnDate")} value={window.end} timeZone={tz} lang={lang} prevLabel={t("mobile.previousDay")} nextLabel={t("mobile.nextDay")}
          onChange={(end) => setWindow((w) => ({ ...w, end }))} />
      </Card>

      {branches.length > 1 ? (
        <Card>
          <Label>{t("search.pickupLocation")}</Label>
          <Row>{branches.map((b) => <Chip key={b.id} label={b.name} selected={b.id === pickup} onPress={() => setPickup(b.id)} />)}</Row>
          <Label>{t("search.returnLocation")}</Label>
          <Row>{branches.map((b) => <Chip key={b.id} label={b.name} selected={b.id === ret} onPress={() => setRet(b.id)} />)}</Row>
        </Card>
      ) : null}

      {quote ? (
        <Card>
          <H2>{t("checkout.summary")}</H2>
          {quote.lines.map((l, i) => (
            <Row key={i} style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <Body style={{ flex: 1 }}>{priceLineLabel(lang, l.label, l.labelParams, l.quantity)}</Body>
              <Body>{formatMoney(l.amountMinor, quote.currency as never, lang)}</Body>
            </Row>
          ))}
          <Row style={{ justifyContent: "space-between", borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 8 }}>
            <H2>{t("common.total")}</H2><H2>{formatMoney(quote.totalMinor, quote.currency as never, lang)}</H2>
          </Row>
          {quote.depositMinor > 0 ? <Body muted>{t("pricing.deposit")}: {formatMoney(quote.depositMinor, quote.currency as never, lang)}</Body> : null}
        </Card>
      ) : null}

      {error ? <ErrorText>{translateError(lang, error)}</ErrorText> : null}
      <Button title={session ? t("common.bookNow") : t("checkout.signInRequired")} onPress={book} busy={busy} disabled={!quote} />
    </Screen>
  );
}
