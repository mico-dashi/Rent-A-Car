import { describe, expect, it } from "vitest";
import { accessibleButton, buildTheme, contrastRatio, DEFAULT_BRAND, readableOn, themeToCssVars } from "../src";

describe("theme", () => {
  it("default dark theme has AA body text contrast", () => {
    const t = buildTheme(DEFAULT_BRAND, "dark");
    expect(contrastRatio(t.text, t.background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(t.textMuted, t.surface)).toBeGreaterThanOrEqual(4.5);
  });
  it("light theme has AA contrast", () => {
    const t = buildTheme(DEFAULT_BRAND, "light");
    expect(contrastRatio(t.text, t.background)).toBeGreaterThanOrEqual(7);
  });
  it("rejects too-light tenant backgrounds in dark mode", () => {
    expect(buildTheme({ ...DEFAULT_BRAND, backgroundColor: "#777777" }, "dark").background).toBe("#010101");
  });
  it("picks the more readable of black/white", () => {
    expect(readableOn("#1A1A1A")).toBe("#FFFFFF");
    expect(readableOn("#FFE600")).toBe("#010101");
  });
  it("derives an AA-compliant button from any brand colour", () => {
    for (const brand of ["#EC0618", "#FFE600", "#00A3FF", "#7B61FF", "#2ECC71", "#FFFFFF", "#000000"]) {
      const b = accessibleButton(brand);
      expect(contrastRatio(b.background, b.text), brand).toBeGreaterThanOrEqual(4.5);
    }
    // The default red already supports white labels at AA.
    expect(accessibleButton("#EC0618")).toEqual({ background: "#EC0618", text: "#FFFFFF" });
    // A lighter red is darkened just enough to keep white labels.
    const light = accessibleButton("#FF4D5A");
    expect(light.text).toBe("#FFFFFF");
    expect(light.background).not.toBe("#FF4D5A");
  });
  it("emits css variables", () => {
    const vars = themeToCssVars(buildTheme(DEFAULT_BRAND, "dark"));
    expect(vars["--color-on-primary"]).toBe("#FFFFFF");
    expect(vars["--color-primary"]).toBe("#EC0618");
  });
});
