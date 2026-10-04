import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";


const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    "@rental/api-client", "@rental/auth", "@rental/config", "@rental/database", "@rental/design-tokens",
    "@rental/domain", "@rental/localization", "@rental/payments", "@rental/types", "@rental/validation", "@rental/server",
  ],
  images: {
    remotePatterns: supabaseUrl ? [{ protocol: "https", hostname: new URL(supabaseUrl).hostname, pathname: "/storage/v1/**" }] : [],
    formats: ["image/avif", "image/webp"],
  },
  // Content-Security-Policy is set per request with a nonce in src/middleware.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self \"https://js.stripe.com\")" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
