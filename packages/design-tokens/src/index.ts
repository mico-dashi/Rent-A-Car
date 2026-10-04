/**
 * Design tokens. The default "Apex" theme: charcoal/black surfaces with a red
 * accent used sparingly. Tenants override brand colours; neutrals, spacing,
 * radii and motion stay consistent so every storefront feels premium.
 */

export const palette = {
  red: "#EC0618",
  charcoal: "#212325",
  black: "#010101",
  offWhite: "#F5F4F2",
  white: "#FFFFFF",
  gray: {
    50: "#F7F7F8", 100: "#EDEDEF", 200: "#D9DADD", 300: "#B9BBC0", 400: "#8E9197",
    500: "#6B6E75", 600: "#4E5157", 700: "#36383C", 800: "#2A2C2F", 900: "#18191B",
  },
  success: "#1FA971",
  warning: "#E8A317",
  danger: "#E5484D",
  info: "#3E8EF7",
} as const;

export const radii = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80 } as const;
export const typography = {
  fontFamily: { heading: "Inter", body: "Inter", mono: "JetBrains Mono" },
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, "2xl": 28, "3xl": 36, "4xl": 48, "5xl": 64 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, black: 800 },
  tracking: { tight: -0.02, normal: 0, wide: 0.08 },
} as const;
export const motion = {
  duration: { fast: 120, base: 200, slow: 320 },
  easing: { standard: "cubic-bezier(0.2, 0, 0, 1)", emphasized: "cubic-bezier(0.3, 0, 0, 1.2)" },
} as const;
export const elevation = {
  card: "0 1px 2px rgba(0,0,0,.24), 0 8px 24px rgba(0,0,0,.18)",
  raised: "0 12px 40px rgba(0,0,0,.35)",
} as const;

export type ColorScheme = "light" | "dark";

export interface SemanticColors {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  /** Brand accent for large fills, icons, focus rings. */
  primary: string;
  /** Solid button background derived from the brand so its label meets WCAG AA (4.5:1). */
  primaryButton: string;
  onPrimary: string;
  secondary: string;
  focusRing: string;
  success: string;
  warning: string;
  danger: string;
}

export interface BrandInput {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
}

// ---------- WCAG contrast helpers ----------
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Invalid hex colour ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Black or white — whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, palette.white) >= contrastRatio(bg, palette.black) ? palette.white : palette.black;
}

function mixWithBlack(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(c * (1 - amount)).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`.toUpperCase();
}

/**
 * Accessible solid-button pairing for a brand colour: keep the colour if a
 * label colour reaches 4.5:1, otherwise darken it just enough for white text.
 */
export function accessibleButton(brand: string): { background: string; text: string } {
  if (contrastRatio(brand, palette.white) >= 4.5) return { background: brand.toUpperCase(), text: palette.white };
  if (luminance(brand) > 0.4 && contrastRatio(brand, palette.black) >= 4.5) return { background: brand.toUpperCase(), text: palette.black };
  for (let step = 1; step <= 20; step++) {
    const candidate = mixWithBlack(brand, step * 0.03);
    if (contrastRatio(candidate, palette.white) >= 4.5) return { background: candidate, text: palette.white };
  }
  return { background: palette.charcoal, text: palette.white };
}

/**
 * Build semantic colours for a tenant and scheme. Tenant backgrounds only apply
 * to dark mode if dark enough to keep body text AA-compliant; otherwise the
 * default charcoal/black is used. The primary accent is kept for large UI but
 * the text colour on it is chosen automatically for contrast.
 */
export function buildTheme(brand: BrandInput, scheme: ColorScheme): SemanticColors {
  const isDark = scheme === "dark";
  const candidateBg = isDark ? brand.backgroundColor : palette.offWhite;
  const background = isDark && contrastRatio(candidateBg, palette.offWhite) < 7 ? palette.black : candidateBg;
  return {
    background,
    surface: isDark ? palette.charcoal : palette.white,
    surfaceRaised: isDark ? palette.gray[800] : palette.gray[50],
    border: isDark ? palette.gray[700] : palette.gray[200],
    text: isDark ? palette.offWhite : palette.gray[900],
    textMuted: isDark ? palette.gray[300] : palette.gray[600],
    primary: brand.primaryColor,
    primaryButton: accessibleButton(brand.primaryColor).background,
    onPrimary: accessibleButton(brand.primaryColor).text,
    secondary: brand.secondaryColor,
    focusRing: brand.primaryColor,
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
  };
}

/** CSS custom properties for web (`style` on <html> or a <style> block). */
export function themeToCssVars(theme: SemanticColors): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme)) {
    vars[`--color-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`] = v;
  }
  return vars;
}

export const DEFAULT_BRAND: BrandInput = {
  primaryColor: palette.red,
  secondaryColor: palette.charcoal,
  backgroundColor: palette.black,
};
