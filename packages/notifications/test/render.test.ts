import { describe, expect, it } from "vitest";
import { nextAttemptDelayMs, render, resolveTemplate, type Template } from "../src";

const t = (o: Partial<Template>): Template => ({ tenantId: null, event: "booking.confirmed", channel: "EMAIL", language: "en", subject: "s", body: "b", isActive: true, ...o });

describe("notifications", () => {
  it("escapes HTML in email bodies but not in plain text", () => {
    expect(render("Hi {{name}}", { name: "<script>" }, { html: true })).toBe("Hi &lt;script&gt;");
    expect(render("Hi {{name}}", { name: "<b>" }, { html: false })).toBe("Hi <b>");
    expect(render("{{missing}}!", {}, { html: true })).toBe("!");
  });
  it("prefers tenant templates in the user's language, then falls back", () => {
    const all = [t({ body: "platform-en" }), t({ language: "sq", body: "platform-sq" }), t({ tenantId: "T", body: "tenant-en" })];
    expect(resolveTemplate(all, { tenantId: "T", event: "booking.confirmed", channel: "EMAIL", language: "sq" })?.body).toBe("platform-sq");
    expect(resolveTemplate(all, { tenantId: "T", event: "booking.confirmed", channel: "EMAIL", language: "en" })?.body).toBe("tenant-en");
    expect(resolveTemplate(all, { tenantId: "X", event: "booking.confirmed", channel: "EMAIL", language: "de" })?.body).toBe("platform-en");
    expect(resolveTemplate(all, { tenantId: "T", event: "unknown", channel: "EMAIL", language: "en" })).toBeNull();
  });
  it("backs off and eventually gives up", () => {
    expect(nextAttemptDelayMs(0)).toBe(60_000);
    expect(nextAttemptDelayMs(3)).toBe(480_000);
    expect(nextAttemptDelayMs(6)).toBeNull();
  });
});
