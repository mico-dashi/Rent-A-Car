"use client";

import { useActionState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";

export type ActionResult =
  | { ok: true; message?: string; data?: Record<string, unknown> }
  | { ok: false; error: string; fields?: Record<string, string> }
  | null;

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

function Submit({ label, pendingLabel, variant }: { label: string; pendingLabel: string; variant: "primary" | "ghost" | "danger" }) {
  const { pending } = useFormStatus();
  const cls = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-ghost border-bad text-bad" : "btn-ghost";
  return <button type="submit" className={`${cls} px-4 py-2 text-sm`} disabled={pending}>{pending ? pendingLabel : label}</button>;
}

/**
 * Progressive-enhancement form bound to a server action. Errors arrive as
 * stable codes and are translated client-side; field errors render inline.
 */
export function ActionForm({
  action, lang, submitLabel, children, className, variant = "primary", confirm, resetOnSuccess, successLabel,
}: {
  action: Action; lang: LanguageCode; submitLabel: string; children?: ReactNode; className?: string;
  variant?: "primary" | "ghost" | "danger"; confirm?: string; resetOnSuccess?: boolean; successLabel?: string;
}) {
  const t = useMemo(() => createTranslator(lang), [lang]);
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className ?? "space-y-4"}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {children}
      {state && !state.ok && state.fields ? (
        <ul className="space-y-1 text-xs text-bad" role="alert">
          {Object.entries(state.fields).map(([k, v]) => <li key={k}><strong>{k}</strong>: {v}</li>)}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Submit label={submitLabel} pendingLabel={t("common.loading")} variant={variant} />
        {state && !state.ok ? <p role="alert" className="text-sm text-bad">{t(`admin.errors.${state.error}`) === `admin.errors.${state.error}` ? t(`errors.${state.error}`) : t(`admin.errors.${state.error}`)}</p> : null}
        {state?.ok ? <p role="status" className="text-sm text-ok">{state.message ?? successLabel ?? t("admin.common.saved")}</p> : null}
      </div>
    </form>
  );
}

export function Field({ label, name, type = "text", defaultValue, required, placeholder, step, min, max, hint, autoComplete, pattern }: {
  label: string; name: string; type?: string; defaultValue?: string | number | null; required?: boolean; placeholder?: string;
  step?: string; min?: string | number; max?: string | number; hint?: string; autoComplete?: string; pattern?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}{required ? " *" : ""}</label>
      <input id={name} name={name} type={type} className="field" defaultValue={defaultValue ?? undefined} required={required}
        placeholder={placeholder} step={step} min={min} max={max} autoComplete={autoComplete} pattern={pattern} />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Select({ label, name, options, defaultValue, required }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string | null; required?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}{required ? " *" : ""}</label>
      <select id={name} name={name} className="field" defaultValue={defaultValue ?? undefined} required={required}>
        {!required ? <option value="">—</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function TextArea({ label, name, defaultValue, rows = 4, required, maxLength }: { label: string; name: string; defaultValue?: string | null; rows?: number; required?: boolean; maxLength?: number }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}{required ? " *" : ""}</label>
      <textarea id={name} name={name} rows={rows} className="field" defaultValue={defaultValue ?? undefined} required={required} maxLength={maxLength} />
    </div>
  );
}

export function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 accent-[var(--color-primary)]" /> {label}
    </label>
  );
}

export function Hidden({ name, value }: { name: string; value: string | number }) {
  return <input type="hidden" name={name} value={value} />;
}
