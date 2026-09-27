"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import { moveBookingAction } from "./actions";

export interface TLBlock { id: string; vehicleId: string; kind: string; start: number; end: number; label: string; bookingId: string | null; href: string | null; hold: boolean }
export interface TLVehicle { id: string; label: string }

const KIND_CLASS: Record<string, string> = {
  BOOKING: "bg-brand text-on-brand",
  MAINTENANCE: "bg-warn text-bg",
  CLEANING: "bg-[var(--color-info,#3E8EF7)] text-white",
  MANUAL: "bg-muted text-bg",
  TRANSFER: "bg-fg text-bg",
};

/**
 * Vehicle × day timeline. Staff with bookings.write can drag a booking onto
 * another vehicle; the server re-validates (exclusion constraint, class rules).
 */
export function Timeline({ vehicles, blocks, from, days, canMove, lang, slug }: {
  vehicles: TLVehicle[]; blocks: TLBlock[]; from: number; days: number; canMove: boolean; lang: LanguageCode; slug: string;
}) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const span = days * 86_400_000;
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - from) / span) * 100))}%`;
  const dayLabels = Array.from({ length: days }, (_, i) => new Date(from + i * 86_400_000));

  function drop(vehicleId: string, e: React.DragEvent) {
    e.preventDefault();
    const bookingId = e.dataTransfer.getData("text/booking");
    const fromVehicle = e.dataTransfer.getData("text/vehicle");
    if (!bookingId || fromVehicle === vehicleId) return;
    start(async () => {
      const fd = new FormData();
      fd.set("_tenant", slug); fd.set("bookingId", bookingId); fd.set("vehicleId", vehicleId);
      const res = await moveBookingAction(null, fd);
      setMsg(res?.ok ? t("admin.calendar.moved") : t(`errors.${res && !res.ok ? res.error : "INTERNAL_ERROR"}`));
      router.refresh();
    });
  }

  return (
    <div>
      {msg ? <p role="status" className="mb-3 text-sm">{msg}</p> : null}
      <div className={`overflow-x-auto ${pending ? "opacity-60" : ""}`}>
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[200px_1fr] border-b border-line text-xs text-muted">
            <div />
            <div className="relative flex">{dayLabels.map((d) => <div key={d.getTime()} className="flex-1 border-l border-line px-1 py-2">{d.toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</div>)}</div>
          </div>
          {vehicles.map((v) => (
            <div key={v.id} className="grid grid-cols-[200px_1fr] border-b border-line" onDragOver={(e) => canMove && e.preventDefault()} onDrop={(e) => canMove && drop(v.id, e)}>
              <div className="truncate px-2 py-3 text-sm">{v.label}</div>
              <div className="relative h-12" aria-label={v.label}>
                {dayLabels.map((d, i) => <div key={i} className="absolute top-0 h-full border-l border-line" style={{ left: `${(i / days) * 100}%` }} />)}
                {blocks.filter((b) => b.vehicleId === v.id).map((b) => {
                  const left = pct(b.start);
                  const width = `calc(${pct(b.end)} - ${left})`;
                  const draggable = canMove && b.kind === "BOOKING" && Boolean(b.bookingId);
                  const cls = `absolute top-2 h-8 overflow-hidden truncate rounded-md px-2 text-xs leading-8 ${KIND_CLASS[b.kind] ?? "bg-raised"} ${b.hold ? "opacity-60" : ""} ${draggable ? "cursor-grab" : ""}`;
                  const content = <>{b.label}</>;
                  return b.href ? (
                    <a key={b.id} href={b.href} title={b.label} draggable={draggable} className={cls} style={{ left, width }}
                      onDragStart={(e) => { e.dataTransfer.setData("text/booking", b.bookingId!); e.dataTransfer.setData("text/vehicle", v.id); }}>{content}</a>
                  ) : <div key={b.id} title={b.label} className={cls} style={{ left, width }}>{content}</div>;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
        {Object.keys(KIND_CLASS).map((k) => <li key={k} className="flex items-center gap-2"><span className={`inline-block h-3 w-3 rounded-sm ${KIND_CLASS[k]}`} />{t(`admin.calendar.kinds.${k}`)}</li>)}
      </ul>
    </div>
  );
}
