/**
 * Content-Security-Policy with a per-request nonce (set by each app's
 * middleware). `'strict-dynamic'` lets scripts loaded by nonced scripts run
 * (Next.js chunks, Stripe.js, Google Maps), so no `'unsafe-inline'` is needed
 * for scripts; the host list is a fallback for browsers without CSP3.
 * Dependency-free so it can run in the Edge runtime.
 */
export function buildCsp(opts: { nonce: string; supabaseUrl: string; isDev: boolean; allowStripeFrames?: boolean }): string {
  const { nonce, supabaseUrl, isDev } = opts;
  const wss = supabaseUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com https://maps.googleapis.com`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabaseUrl} https://*.stripe.com https://maps.gstatic.com https://maps.googleapis.com`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseUrl} ${wss} https://api.stripe.com https://maps.googleapis.com`,
    opts.allowStripeFrames ? "frame-src https://js.stripe.com https://hooks.stripe.com" : "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** 128-bit random nonce, base64 (Web Crypto; works in Edge and Node). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
