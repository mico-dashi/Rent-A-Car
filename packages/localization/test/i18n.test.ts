import { describe, expect, it } from "vitest";
import { en } from "../src/messages/en";
import { sq } from "../src/messages/sq";
import { formatDateTime, formatMoney, negotiateLanguage, translate } from "../src";

function keys(o: object, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe("localization", () => {
  it("Albanian catalogue covers every English key", () => {
    expect(keys(sq).sort()).toEqual(keys(en).sort());
  });
  it("interpolates and pluralises", () => {
    expect(translate("en", "search.results", { count: 1 })).toBe("1 car available");
    expect(translate("en", "search.results", { count: 3 })).toBe("3 cars available");
    expect(translate("sq", "vehicle.seats", { count: 4 })).toBe("4 vende");
    expect(translate("en", "missing.key")).toBe("missing.key");
  });
  it("formats money from minor units", () => {
    expect(formatMoney(12_500, "EUR", "en")).toBe("€125.00");
    expect(formatMoney(12_500, "EUR", "en", { compact: true })).toBe("€125");
  });
  it("renders times in the branch timezone", () => {
    expect(formatDateTime("2026-10-24T22:30:00Z", "Europe/Tirane", "en", "short")).toContain("00:30");
  });
  it("negotiates language", () => {
    expect(negotiateLanguage("sq-AL,sq;q=0.9,en;q=0.8")).toBe("sq");
    expect(negotiateLanguage("de-DE")).toBe("en");
  });
});
