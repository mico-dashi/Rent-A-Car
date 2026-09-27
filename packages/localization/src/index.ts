import type { CurrencyCode, LanguageCode } from "@rental/types";
import { en, type Messages } from "./messages/en";
import { sq } from "./messages/sq";

export type { Messages };
export const catalogs: Record<LanguageCode, Messages> = { en, sq };
export const DEFAULT_LANGUAGE: LanguageCode = "en";

const LOCALE: Record<LanguageCode, string> = { en: "en-GB", sq: "sq-AL" };
export function localeFor(lang: LanguageCode): string {
  return LOCALE[lang];
}

export function negotiateLanguage(acceptLanguage: string | null | undefined, fallback: LanguageCode = DEFAULT_LANGUAGE): LanguageCode {
  if (!acceptLanguage) return fallback;
  for (const part of acceptLanguage.split(",")) {
    const code = part.split(";")[0]?.trim().slice(0, 2).toLowerCase();
    if (code === "en" || code === "sq") return code;
  }
  return fallback;
}

type Params = Record<string, string | number>;

function lookup(messages: Messages, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), messages);
}

function interpolate(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

/**
 * Translate `key` with ICU-lite interpolation and plural selection
 * (`{ one, other }` objects keyed by Intl.PluralRules with `params.count`).
 * Missing keys return the key itself so gaps are visible but never crash.
 */
export function translate(lang: LanguageCode, key: string, params: Params = {}): string {
  const value = lookup(catalogs[lang], key) ?? lookup(catalogs[DEFAULT_LANGUAGE], key);
  if (typeof value === "string") return interpolate(value, params);
  if (value && typeof value === "object" && "other" in value) {
    const forms = value as Record<string, string>;
    const count = typeof params.count === "number" ? params.count : Number(params.count ?? 0);
    const rule = new Intl.PluralRules(localeFor(lang)).select(count);
    return interpolate(forms[rule] ?? forms.other!, params);
  }
  return key;
}

export function createTranslator(lang: LanguageCode) {
  return (key: string, params?: Params) => translate(lang, key, params);
}

const currencyDigits: Record<CurrencyCode, number> = { EUR: 2, USD: 2, GBP: 2, ALL: 2, CHF: 2 };

/** Format integer minor units. Division happens only here, for display. */
export function formatMoney(amountMinor: number, currency: CurrencyCode, lang: LanguageCode, opts: { compact?: boolean } = {}): string {
  const digits = currencyDigits[currency];
  const major = amountMinor / 10 ** digits;
  const wholeUnits = amountMinor % 10 ** digits === 0;
  return new Intl.NumberFormat(localeFor(lang), {
    style: "currency",
    currency,
    minimumFractionDigits: opts.compact && wholeUnits ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(major);
}

/** Render a UTC instant in the branch's timezone. */
export function formatDateTime(iso: string | Date, timeZone: string, lang: LanguageCode, style: "short" | "medium" | "long" = "medium"): string {
  return new Intl.DateTimeFormat(localeFor(lang), { dateStyle: style, timeStyle: "short", timeZone }).format(new Date(iso));
}

export function formatDate(iso: string | Date, timeZone: string, lang: LanguageCode): string {
  return new Intl.DateTimeFormat(localeFor(lang), { dateStyle: "medium", timeZone }).format(new Date(iso));
}
