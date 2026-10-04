"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { createTranslator, formatDateTime, formatMoney } from "@rental/localization";
import type { CurrencyCode, LanguageCode } from "@rental/types";
import { PriceBreakdown, type BreakdownData } from "@/components/price-breakdown";

export interface ExtraItem {
  id: string;
  name: string;
  description: string | null;
  kind: "EXTRA" | "INSURANCE";
  billing: string;
  priceMinor: number;
  maxQuantity: number;
}

interface Props {
  lang: LanguageCode;
  tenantId: string;
  vehicle: { id: string; name: string; minAge: number };
  pickup: { id: string; name: string; timezone: string };
  ret: { id: string; name: string };
  startsAt: string;
  endsAt: string;
  extras: ExtraItem[];
  currency: CurrencyCode;
  stripePublishableKey: string | null;
}

type Created = { id: string; reference: string; holdExpiresAt: string | null; payment: { clientSecret: string | null; stripeAccount: string | null } | null };

export function CheckoutForm(p: Props) {
  const t = useMemo(() => createTranslator(p.lang), [p.lang]);
  const router = useRouter();
  const idempotencyKey = useRef<string>(crypto.randomUUID()); // one key per checkout attempt => safe retries
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [dob, setDob] = useState("");
  const [code, setCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [quote, setQuote] = useState<BreakdownData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const request = useMemo(() => ({
    tenantId: p.tenantId, vehicleId: p.vehicle.id, pickupBranchId: p.pickup.id, returnBranchId: p.ret.id, startsAt: p.startsAt, endsAt: p.endsAt,
    extras: Object.entries(selected).filter(([, q]) => q > 0).map(([extraId, quantity]) => ({ extraId, quantity })),
    ...(dob ? { driverDateOfBirth: dob } : {}), ...(code.trim() ? { discountCode: code.trim() } : {}),
  }), [p, selected, dob, code]);

  useEffect(() => {
    if (created) return;
    const ctrl = new AbortController();
    fetch("/api/v1/quotes", { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(request) })
      .then(async (r) => { const j = await r.json(); if (r.ok) { setQuote(j); setError(null); } else setError(j?.error?.code ?? "INTERNAL_ERROR"); })
      .catch((e: unknown) => { if ((e as Error).name !== "AbortError") setError("INTERNAL_ERROR"); });
    return () => ctrl.abort();
  }, [request, created]);

  async function reserve() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/bookings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, idempotencyKey: idempotencyKey.current, acceptedTermsVersion: "1" }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(json?.error?.code ?? "INTERNAL_ERROR");
    if (!json.payment) return router.push(`/account/bookings/${json.id}`);
    setCreated(json);
  }

  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    if (!created?.payment?.clientSecret || !p.stripePublishableKey) return null;
    return loadStripe(p.stripePublishableKey, created.payment.stripeAccount ? { stripeAccount: created.payment.stripeAccount } : undefined);
  }, [created, p.stripePublishableKey]);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_400px]">
      <div className="space-y-8">
        <h1 className="font-display text-3xl font-black">{t("checkout.title")}</h1>
        <section className="card p-6">
          <h2 className="font-display text-lg font-bold">{t("checkout.summary")}</h2>
          <p className="mt-2 text-xl font-semibold">{p.vehicle.name}</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="label">{t("search.pickupDate")}</dt><dd>{p.pickup.name} · {formatDateTime(p.startsAt, p.pickup.timezone, p.lang)}</dd></div>
            <div><dt className="label">{t("search.returnDate")}</dt><dd>{p.ret.name} · {formatDateTime(p.endsAt, p.pickup.timezone, p.lang)}</dd></div>
          </dl>
        </section>

        <fieldset className="card p-6" disabled={Boolean(created)}>
          <legend className="sr-only">{t("checkout.driver")}</legend>
          <h2 className="font-display text-lg font-bold">{t("checkout.driver")}</h2>
          <div className="mt-4 max-w-xs">
            <label className="label" htmlFor="dob">{t("checkout.dateOfBirth")}</label>
            <input id="dob" type="date" className="field" value={dob} onChange={(e) => setDob(e.target.value)} autoComplete="bday" />
            <p className="mt-2 text-xs text-muted">{t("vehicle.minAge", { age: p.vehicle.minAge })}</p>
          </div>
        </fieldset>

        {p.extras.length ? (
          <fieldset className="card p-6" disabled={Boolean(created)}>
            <legend className="sr-only">{t("checkout.extras")}</legend>
            <h2 className="font-display text-lg font-bold">{t("checkout.extras")}</h2>
            <ul className="mt-4 divide-y divide-line">
              {p.extras.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold">{e.name}</p>
                    {e.description ? <p className="text-xs text-muted">{e.description}</p> : null}
                    <p className="text-xs text-muted">{e.billing === "FREE" ? "—" : `${formatMoney(e.priceMinor, p.currency, p.lang)}${e.billing === "PER_DAY" ? ` / ${t("common.perDay")}` : ""}`}</p>
                  </div>
                  {e.maxQuantity > 1 ? (
                    <select aria-label={e.name} className="field w-20" value={selected[e.id] ?? 0} onChange={(ev) => setSelected({ ...selected, [e.id]: Number(ev.target.value) })}>
                      {Array.from({ length: e.maxQuantity + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  ) : (
                    <input type="checkbox" aria-label={e.name} className="h-5 w-5 accent-[var(--color-primary)]" checked={(selected[e.id] ?? 0) > 0}
                      onChange={(ev) => setSelected({ ...selected, [e.id]: ev.target.checked ? 1 : 0 })} />
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-4 max-w-xs">
              <label className="label" htmlFor="code">{t("checkout.promoCode")}</label>
              <input id="code" className="field uppercase" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} />
            </div>
          </fieldset>
        ) : null}

        {!created ? (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--color-primary)]" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>{t("checkout.terms")} (<Link href="/terms" className="underline" target="_blank">{t("nav.terms")}</Link>, <Link href="/privacy" className="underline" target="_blank">{t("nav.privacy")}</Link>)</span>
          </label>
        ) : null}

        {created && stripePromise && created.payment?.clientSecret ? (
          <section className="card p-6">
            <h2 className="font-display text-lg font-bold">{t("checkout.paymentTitle")}</h2>
            {created.holdExpiresAt ? <p className="mt-1 text-sm text-muted">{t("checkout.holdNotice", { minutes: Math.max(1, Math.round((Date.parse(created.holdExpiresAt) - Date.now()) / 60000)) })}</p> : null}
            <Elements stripe={stripePromise} options={{ clientSecret: created.payment.clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#EC0618" } } }}>
              <PayStep bookingId={created.id} lang={p.lang} amountLabel={quote ? formatMoney(quote.dueNowMinor, p.currency, p.lang) : ""} />
            </Elements>
          </section>
        ) : null}
        {created && !stripePromise ? <p role="alert" className="text-sm text-bad">{t("errors.PAYMENTS_NOT_CONFIGURED")}</p> : null}
      </div>

      <aside className="card h-fit p-6 lg:sticky lg:top-24">
        {quote ? <PriceBreakdown data={quote} lang={p.lang} /> : <div className="space-y-2"><div className="skeleton h-4" /><div className="skeleton h-4 w-2/3" /><div className="skeleton h-8 w-1/2" /></div>}
        {error ? <p role="alert" className="mt-4 text-sm text-bad">{t(`errors.${error}`)}</p> : null}
        {!created ? (
          <button type="button" className="btn-primary mt-6 w-full" disabled={!quote || !accepted || busy || Boolean(error)} onClick={reserve}>
            {busy ? t("checkout.processing") : quote && quote.dueNowMinor > 0 ? t("common.continue") : t("checkout.reserve")}
          </button>
        ) : null}
      </aside>
    </div>
  );
}

function PayStep({ bookingId, lang, amountLabel }: { bookingId: string; lang: LanguageCode; amountLabel: string }) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    // Success is confirmed server-side by the verified webhook, never by this redirect.
    const { error: err } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/account/bookings/${bookingId}?paid=1` } });
    setBusy(false);
    if (err) setError(err.message ?? t("common.genericError"));
  }

  return (
    <form onSubmit={pay} className="mt-4 space-y-4">
      <PaymentElement options={{ layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" } }} />
      {error ? <p role="alert" className="text-sm text-bad">{error}</p> : null}
      <button className="btn-primary w-full" disabled={!stripe || busy} type="submit">{busy ? t("checkout.processing") : t("checkout.pay", { amount: amountLabel })}</button>
    </form>
  );
}
