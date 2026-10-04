import { setLanguage } from "@/app/actions";
import type { LanguageCode } from "@rental/types";

export function LanguageSwitch({ current }: { current: LanguageCode }) {
  const next: LanguageCode = current === "en" ? "sq" : "en";
  return (
    <form action={setLanguage}>
      <input type="hidden" name="lang" value={next} />
      <button type="submit" className="rounded-sm px-2 py-1 text-xs font-bold uppercase tracking-widest text-muted hover:text-fg" aria-label={next === "sq" ? "Shqip" : "English"}>
        {next}
      </button>
    </form>
  );
}
