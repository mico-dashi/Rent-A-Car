import "server-only";
import { cookies, headers } from "next/headers";
import { createTranslator, negotiateLanguage } from "@rental/localization";
import type { LanguageCode } from "@rental/types";

export async function getLang(): Promise<LanguageCode> {
  const c = (await cookies()).get("lang")?.value;
  if (c === "en" || c === "sq") return c;
  return negotiateLanguage((await headers()).get("accept-language"), "en");
}

export async function getT() {
  const lang = await getLang();
  return { lang, t: createTranslator(lang) };
}
