"use client";

import { useState } from "react";

/**
 * Minimal, dependency-free SVG charts. Single series, one hue (brand accent),
 * thin marks with 4px rounded data ends, 2px gaps, recessive grid, and a
 * per-mark hover/focus tooltip. Text uses text tokens, never the series colour.
 */
export function ColumnChart({ data, format, label, height = 220 }: {
  data: { x: string; y: number; xLabel: string }[]; format: (v: number) => string; label: string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, padL = 56, padB = 28, padT = 12;
  const max = Math.max(1, ...data.map((d) => d.y));
  const nice = niceMax(max);
  const bw = data.length ? (W - padL) / data.length : 0;
  const barW = Math.max(2, bw - 2);
  const yOf = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const ticks = [0, 0.5, 1].map((f) => nice * f);
  const labelEvery = Math.ceil(data.length / 8);
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={padL} x2={W} y1={yOf(tk)} y2={yOf(tk)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={padL - 8} y={yOf(tk) + 4} textAnchor="end" fontSize={11} fill="var(--color-text-muted)">{format(tk)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * bw + 1;
          const y = yOf(d.y);
          const h = Math.max(0, H - padB - y);
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.x} tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              {/* hit target larger than the mark */}
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {h > 0 ? <path d={`M${x},${H - padB} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${H - padB} Z`}
                fill="var(--color-primary)" opacity={hover === null || hover === i ? 1 : 0.45} /> : null}
              {i % labelEvery === 0 ? <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-text-muted)">{d.xLabel}</text> : null}
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={H - padB} y2={H - padB} stroke="var(--color-border)" />
      </svg>
      {hover !== null && data[hover] ? (
        <figcaption className="pointer-events-none absolute right-2 top-2 rounded-md border border-line bg-raised px-3 py-2 text-xs shadow-lg" role="status">
          <span className="text-muted">{data[hover]!.xLabel}</span> <strong className="ml-2">{format(data[hover]!.y)}</strong>
        </figcaption>
      ) : null}
    </figure>
  );
}

export function BarList({ rows, format, label }: { rows: { key: string; label: string; value: number; sub?: string }[]; format: (v: number) => string; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${format(r.value)}`}>
          <div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate">{r.label}{r.sub ? <span className="ml-2 text-xs text-muted">{r.sub}</span> : null}</span><span className="tabular-nums text-muted">{format(r.value)}</span></div>
          <div className="h-2 rounded-full bg-raised"><div className="h-2 rounded-full bg-brand" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
