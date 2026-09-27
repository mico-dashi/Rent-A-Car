import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/.expo/**", "rental car company/**", "**/next-env.d.ts", "**/*.config.*"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "@next/next/no-html-link-for-pages": "off",
    },
    settings: { next: { rootDir: ["apps/web/", "apps/admin/"] } },
  },
  {
    // Browser/client code must never import the service-role factory or server env.
    files: ["**/*.tsx", "apps/web/src/lib/supabase/browser.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "@/lib/env", message: "Server env is server-only." }] }],
    },
  },
);
