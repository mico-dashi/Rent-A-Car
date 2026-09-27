import Link from "next/link";
import type { ReactNode } from "react";
import { cn, statusTone } from "@rental/ui";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-black tracking-tight md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("card p-5", className)}>
      {title || actions ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="font-display text-base font-bold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "bad" | "ok" | "warn" }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-2 font-display text-2xl font-black", tone === "bad" && "text-bad", tone === "ok" && "text-ok", tone === "warn" && "text-warn")}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const toneClass = { neutral: "border-line text-muted", success: "border-ok/40 text-ok", warning: "border-warn/40 text-warn", danger: "border-bad/40 text-bad", info: "border-line text-fg" } as const;

export function Badge({ children, status }: { children: ReactNode; status?: string }) {
  const tone = (status && statusTone[status]) || "neutral";
  return <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold", toneClass[tone])}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line p-10 text-center text-sm text-muted">{children}</div>;
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "ghost" }) {
  return <Link href={href} className={variant === "primary" ? "btn-primary px-4 py-2 text-sm" : "btn-ghost px-4 py-2 text-sm"}>{children}</Link>;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="table">
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}><dt className="text-xs uppercase tracking-wider text-muted">{k}</dt><dd className="mt-0.5">{v ?? "—"}</dd></div>
      ))}
    </dl>
  );
}

export function Pager({ page, hasMore, href }: { page: number; hasMore: boolean; href: (p: number) => string }) {
  if (page === 0 && !hasMore) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex justify-end gap-2">
      {page > 0 ? <Link className="btn-ghost px-3 py-1.5 text-xs" href={href(page - 1)}>←</Link> : null}
      {hasMore ? <Link className="btn-ghost px-3 py-1.5 text-xs" href={href(page + 1)}>→</Link> : null}
    </nav>
  );
}
