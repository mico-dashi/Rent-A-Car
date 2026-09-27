import { getLocales } from "expo-localization";
import { createTranslator } from "@rental/localization";
import type { LanguageCode } from "@rental/types";

export function deviceLanguage(fallback: string): LanguageCode {
  const code = getLocales()[0]?.languageCode;
  if (code === "sq" || code === "en") return code;
  return fallback === "sq" ? "sq" : "en";
}

export function useT(lang: LanguageCode) {
  return createTranslator(lang);
}
