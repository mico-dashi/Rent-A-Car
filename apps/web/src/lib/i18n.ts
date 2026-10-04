import "server-only";
import { cookies, headers } from "next/headers";
import { createTranslator, negotiateLanguage } from "@rental/localization";
import type { LanguageCode } from "@rental/types";

export async function getLanguage(tenantDefault: string): Promise<LanguageCode> {
  const fromCookie = (await cookies()).get("lang")?.value;
  if (fromCookie === "en" || fromCookie === "sq") return fromCookie;
  const fallback: LanguageCode = tenantDefault === "sq" ? "sq" : "en";
  return negotiateLanguage((await headers()).get("accept-language"), fallback);
}

export async function getT(tenantDefault: string) {
  const lang = await getLanguage(tenantDefault);
  return { lang, t: createTranslator(lang) };
}
