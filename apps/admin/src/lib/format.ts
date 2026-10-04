import { formatDate, formatDateTime, formatMoney } from "@rental/localization";
import type { CurrencyCode, LanguageCode } from "@rental/types";

export const money = (minor: number | null | undefined, cur: CurrencyCode, lang: LanguageCode) =>
  minor === null || minor === undefined ? "—" : formatMoney(Number(minor), cur, lang);
export const dt = (iso: string | null | undefined, tz: string, lang: LanguageCode) => (iso ? formatDateTime(iso, tz, lang, "short") : "—");
export const d = (iso: string | null | undefined, tz: string, lang: LanguageCode) => (iso ? formatDate(iso, tz, lang) : "—");
/** minor units -> "125.50" for form inputs */
export const toMajor = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (Number(minor) / 100).toFixed(2));
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
