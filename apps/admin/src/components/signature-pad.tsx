"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";
import type { ActionResult } from "./forms";

/** Touch/mouse signature capture. Submits a PNG data URL to a server action. */
export function SignaturePad({ lang, label, action, hidden }: {
  lang: LanguageCode; label: string; action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>; hidden: Record<string, string>;
}) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [state, setState] = useState<ActionResult>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111111";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.current!.width, y: ((e.clientY - r.top) / r.height) * canvas.current!.height };
  };
  const clear = () => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    setDirty(false);
  };

  async function submit() {
    setBusy(true);
    const fd = new FormData();
    for (const [k, v] of Object.entries(hidden)) fd.set(k, v);
    fd.set("signerName", name);
    fd.set("signature", canvas.current!.toDataURL("image/png"));
    setState(await action(null, fd));
    setBusy(false);
  }

  return (
    <div className="space-y-2">
      <p className="label">{label}</p>
      <canvas
        ref={canvas} width={600} height={180} aria-label={label} role="img"
        className="h-[150px] w-full touch-none rounded-md border border-line bg-white"
        onPointerDown={(e) => { drawing.current = true; const p = point(e); const ctx = canvas.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(p.x, p.y); canvas.current!.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const p = point(e); const ctx = canvas.current!.getContext("2d")!; ctx.lineTo(p.x, p.y); ctx.stroke(); setDirty(true); }}
        onPointerUp={() => { drawing.current = false; }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs py-2" placeholder={t("admin.pickup.signerName")} aria-label={t("admin.pickup.signerName")} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={clear}>{t("admin.common.clear")}</button>
        <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={!dirty || name.trim().length < 2 || busy} onClick={submit}>{busy ? t("common.loading") : t("admin.pickup.sign")}</button>
        {state && !state.ok ? <span role="alert" className="text-sm text-bad">{t(`errors.${state.error}`)}</span> : null}
        {state?.ok ? <span role="status" className="text-sm text-ok">{t("admin.pickup.signed")}</span> : null}
      </div>
    </div>
  );
}
