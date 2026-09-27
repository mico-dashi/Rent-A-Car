"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createTranslator } from "@rental/localization";
import { utcToZonedLocal, zonedLocalToUtc } from "@rental/domain";
import type { LanguageCode } from "@rental/types";

export interface BranchOption {
  id: string;
  name: string;
  timezone: string;
}

function defaults(tz: string) {
  const start = new Date(Date.now() + 2 * 86_400_000);
  start.setUTCMinutes(0, 0, 0);
  const s = utcToZonedLocal(start, tz).slice(0, 11) + "10:00";
  const e = utcToZonedLocal(new Date(start.getTime() + 3 * 86_400_000), tz).slice(0, 11) + "10:00";
  return { s, e };
}

export function SearchForm({ branches, lang, initial }: {
  branches: BranchOption[];
  lang: LanguageCode;
  initial?: { pickup?: string; ret?: string; start?: string; end?: string };
}) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const router = useRouter();
  const [pickup, setPickup] = useState(initial?.pickup ?? branches[0]?.id ?? "");
  const [ret, setRet] = useState(initial?.ret ?? initial?.pickup ?? branches[0]?.id ?? "");
  const [same, setSame] = useState(!initial?.ret || initial.ret === initial.pickup);
  const tz = branches.find((b) => b.id === pickup)?.timezone ?? "UTC";
  const d = defaults(tz);
  const [start, setStart] = useState(initial?.start ? utcToZonedLocal(new Date(initial.start), tz) : d.s);
  const [end, setEnd] = useState(initial?.end ? utcToZonedLocal(new Date(initial.end), tz) : d.e);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = zonedLocalToUtc(start, tz);
    const en = zonedLocalToUtc(end, tz);
    if (en <= s) return setError(t("errors.INVALID_RENTAL_WINDOW"));
    setError(null);
    const q = new URLSearchParams({ pickup, return: same ? pickup : ret, start: s.toISOString(), end: en.toISOString() });
    router.push(`/search?${q.toString()}`);
  }

  if (branches.length === 0) return null;

  return (
    <form onSubmit={submit} className="card grid gap-4 p-5 shadow-2xl md:grid-cols-[1.3fr_1fr_1fr_auto] md:items-end md:p-6" aria-label={t("common.search")}>
      <div>
        <label className="label" htmlFor="pickup">{t("search.pickupLocation")}</label>
        <select id="pickup" className="field" value={pickup} onChange={(e) => setPickup(e.target.value)}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="accent-[var(--color-primary)]" />
          {t("search.sameReturn")}
        </label>
        {!same ? (
          <div className="mt-3">
            <label className="label" htmlFor="return">{t("search.returnLocation")}</label>
            <select id="return" className="field" value={ret} onChange={(e) => setRet(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        ) : null}
      </div>
      <div>
        <label className="label" htmlFor="start">{t("search.pickupDate")}</label>
        <input id="start" type="datetime-local" className="field" value={start} step={900} onChange={(e) => setStart(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="end">{t("search.returnDate")}</label>
        <input id="end" type="datetime-local" className="field" value={end} step={900} onChange={(e) => setEnd(e.target.value)} required />
      </div>
      <button type="submit" className="btn-primary h-[50px] md:px-8">{t("common.search")}</button>
      {error ? <p role="alert" className="text-sm text-bad md:col-span-4">{error}</p> : null}
    </form>
  );
}
