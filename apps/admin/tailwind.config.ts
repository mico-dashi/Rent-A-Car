import type { Config } from "tailwindcss";
import { radii } from "@rental/design-tokens";

const v = (name: string) => `var(--color-${name})`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v("background"),
        surface: v("surface"),
        raised: v("surface-raised"),
        line: v("border"),
        fg: v("text"),
        muted: v("text-muted"),
        brand: v("primary"),
        "brand-btn": v("primary-button"),
        "on-brand": v("on-primary"),
        ok: v("success"),
        warn: v("warning"),
        bad: v("danger"),
      },
      borderRadius: { xs: `${radii.xs}px`, sm: `${radii.sm}px`, md: `${radii.md}px`, lg: `${radii.lg}px`, xl: `${radii.xl}px` },
      fontFamily: { sans: ["var(--font-body)", "system-ui", "sans-serif"], display: ["var(--font-heading)", "system-ui", "sans-serif"] },
      maxWidth: { page: "1200px" },
    },
  },
  plugins: [],
} satisfies Config;
