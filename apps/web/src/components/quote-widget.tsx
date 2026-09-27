"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createTranslator } from "@rental/localization";
import { utcToZonedLocal, zonedLocalToUtc } from "@rental/domain";
import type { LanguageCode } from "@rental/types";
import { PriceBreakdown, type BreakdownData } from "./price-breakdown";
import type { BranchOption } from "./search-form";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "ok"; data: BreakdownData } | { kind: "error"; code: string };

export function QuoteWidget(props: {
  tenantId: string;
  vehicleId: string;
  branches: BranchOption[];
  vehicleBranchId: string;
  lang: LanguageCode;
  initial: { pickup?: string; ret?: string; start?: string; end?: string };
}) {
  const t = useMemo(() => createTranslator(props.lang), [props.lang]);
  const pickup = props.vehicleBranchId;
  const tz = props.branches.find((b) => b.id === pickup)?.timezone ?? "UTC";
  const [ret, setRet] = useState(props.initial.ret && props.branches.some((b) => b.id === props.initial.ret) ? props.initial.ret : pickup);
  const def = new Date(Date.now() + 2 * 86_400_000);
  const [start, setStart] = useState(props.initial.start ? utcToZonedLocal(new Date(props.initial.start), tz) : utcToZonedLocal(def, tz).slice(0, 11) + "10:00");
  const [end, setEnd] = useState(props.initial.end ? utcToZonedLocal(new Date(props.initial.end), tz) : utcToZonedLocal(new Date(def.getTime() + 3 * 86_400_000), tz).slice(0, 11) + "10:00");
  const [state, setState] = useState<State>({ kind: "idle" });

  const startsAt = useMemo(() => { try { return zonedLocalToUtc(start, tz).toISOString(); } catch { return null; } }, [start, tz]);
  const endsAt = useMemo(() => { try { return zonedLocalToUtc(end, tz).toISOString(); } catch { return null; } }, [end, tz]);

  useEffect(() => {
    if (!startsAt || !endsAt) return;
    if (Date.parse(endsAt) <= Date.parse(startsAt)) { setState({ kind: "error", code: "INVALID_RENTAL_WINDOW" }); return; }
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetch("/api/v1/quotes", {
      method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: props.tenantId, vehicleId: props.vehicleId, pickupBranchId: pickup, returnBranchId: ret, startsAt, endsAt }),
    })
      .then(async (r) => {
        const json = await r.json();
        setState(r.ok ? { kind: "ok", data: json } : { kind: "error", code: json?.error?.code ?? "INTERNAL_ERROR" });
      })
      .catch((e: unknown) => { if ((e as Error).name !== "AbortError") setState({ kind: "error", code: "INTERNAL_ERROR" }); });
    return () => ctrl.abort();
  }, [props.tenantId, props.vehicleId, pickup, ret, startsAt, endsAt]);

  const checkoutHref = `/checkout?${new URLSearchParams({ vehicle: props.vehicleId, pickup, return: ret, start: startsAt ?? "", end: endsAt ?? "" })}`;

  return (
    <div className="card sticky top-24 p-6">
      <h2 className="font-display text-lg font-bold">{t("vehicle.estimatedTotal")}</h2>
      <div className="mt-4 grid gap-3">
        <div><label className="label" htmlFor="q-start">{t("search.pickupDate")}</label>
          <input id="q-start" type="datetime-local" step={900} className="field" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div><label className="label" htmlFor="q-end">{t("search.returnDate")}</label>
          <input id="q-end" type="datetime-local" step={900} className="field" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        {props.branches.length > 1 ? (
          <div><label className="label" htmlFor="q-ret">{t("search.returnLocation")}</label>
            <select id="q-ret" className="field" value={ret} onChange={(e) => setRet(e.target.value)}>
              {props.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
        ) : null}
      </div>
      <div className="mt-6 min-h-24" aria-live="polite">
        {state.kind === "loading" ? <div className="space-y-2"><div className="skeleton h-4" /><div className="skeleton h-4 w-2/3" /><div className="skeleton h-8 w-1/2" /></div> : null}
        {state.kind === "error" ? <p role="alert" className="text-sm text-bad">{t(`errors.${state.code}`)}</p> : null}
        {state.kind === "ok" ? <PriceBreakdown data={state.data} lang={props.lang} /> : null}
      </div>
      {state.kind === "ok" ? (
        <Link href={checkoutHref} className="btn-primary mt-6 w-full text-base uppercase tracking-wider">{t("common.bookNow")}</Link>
      ) : (
        <button type="button" disabled className="btn-primary mt-6 w-full text-base uppercase tracking-wider">{t("common.bookNow")}</button>
      )}
    </div>
  );
}
