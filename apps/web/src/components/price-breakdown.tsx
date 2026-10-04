import { formatMoney, translate } from "@rental/localization";
import type { CurrencyCode, LanguageCode, PriceLine } from "@rental/types";

export interface BreakdownData {
  currency: string;
  lines: PriceLine[];
  totalMinor: number;
  depositMinor: number;
  dueNowMinor: number;
  dueLaterMinor: number;
}

function lineLabel(l: PriceLine, lang: LanguageCode): string {
  if (l.label.startsWith("extra:")) return String(l.labelParams?.name ?? l.label.slice(6));
  return translate(lang, l.label, l.labelParams ?? {});
}

export function PriceBreakdown({ data, lang }: { data: BreakdownData; lang: LanguageCode }) {
  const cur = data.currency as CurrencyCode;
  return (
    <div>
      <dl className="space-y-2 text-sm">
        {data.lines.map((l, i) => (
          <div key={`${l.kind}-${i}`} className="flex justify-between gap-4">
            <dt className="text-muted">{lineLabel(l, lang)}{l.quantity > 1 && (l.kind === "EXTRA" || l.kind === "INSURANCE") ? ` × ${l.quantity}` : ""}</dt>
            <dd className={l.amountMinor < 0 ? "text-ok" : ""}>{formatMoney(l.amountMinor, cur, lang)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
        <span className="font-semibold">{translate(lang, "common.total")}</span>
        <span className="font-display text-2xl font-bold">{formatMoney(data.totalMinor, cur, lang)}</span>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-muted">{translate(lang, "pricing.dueNow")}</dt><dd>{formatMoney(data.dueNowMinor, cur, lang)}</dd></div>
        {data.dueLaterMinor > 0 ? <div className="flex justify-between"><dt className="text-muted">{translate(lang, "pricing.dueLater")}</dt><dd>{formatMoney(data.dueLaterMinor, cur, lang)}</dd></div> : null}
        {data.depositMinor > 0 ? <div className="flex justify-between"><dt className="text-muted">{translate(lang, "pricing.deposit")}</dt><dd>{formatMoney(data.depositMinor, cur, lang)}</dd></div> : null}
      </dl>
    </div>
  );
}
