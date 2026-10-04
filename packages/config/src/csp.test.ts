import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "./csp";

describe("CSP", () => {
  it("uses a nonce and strict-dynamic instead of unsafe-inline for scripts", () => {
    const csp = buildCsp({ nonce: "abc123", supabaseUrl: "https://x.supabase.co", isDev: false });
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(csp).toContain("connect-src 'self' https://x.supabase.co wss://x.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(buildCsp({ nonce: "n", supabaseUrl: "", isDev: false, allowStripeFrames: true })).toContain("frame-src https://js.stripe.com");
  });
  it("allows eval only in development (React refresh)", () => {
    expect(buildCsp({ nonce: "n", supabaseUrl: "", isDev: true })).toContain("'unsafe-eval'");
  });
  it("generates fresh 128-bit nonces", () => {
    const a = createNonce(), b = createNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64")).toHaveLength(16);
  });
});
