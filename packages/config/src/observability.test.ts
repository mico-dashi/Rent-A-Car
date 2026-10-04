import { describe, expect, it } from "vitest";
import { scrubEvent, sentryOrigin } from "./observability";

describe("error report scrubbing", () => {
  it("removes credentials, user identity and e-mail addresses", () => {
    const e = scrubEvent({
      user: { id: "u1", email: "a@b.com", ip_address: "1.2.3.4" },
      message: "Failed for jane.doe@example.com",
      request: {
        url: "https://admin.example.com/auth/callback?code=abc&next=/t/x",
        cookies: { "sb-access-token": "secret" },
        data: { password: "x" },
        headers: { Authorization: "Bearer t", cookie: "c", "user-agent": "UA", "stripe-signature": "s" },
      },
      exception: { values: [{ type: "Error", value: "no customer bob@example.org" }] },
      breadcrumbs: [{ message: "fetch", data: { url: "/api/x?token=abc&a=1" } }],
    });
    expect(e.user).toBeUndefined();
    expect(e.message).toBe("Failed for [email]");
    expect(e.request.cookies).toBeUndefined();
    expect(e.request.data).toBeUndefined();
    expect(e.request.url).toBe("https://admin.example.com/auth/callback?code=%5Bredacted%5D&next=%2Ft%2Fx");
    expect(e.request.headers).toEqual({ Authorization: "[redacted]", cookie: "[redacted]", "user-agent": "UA", "stripe-signature": "[redacted]" });
    expect(e.exception.values[0]!.value).toBe("no customer [email]");
    expect(e.breadcrumbs[0]!.data.url).toBe("/api/x?token=%5Bredacted%5D&a=1");
  });
  it("derives the ingest origin from a DSN", () => {
    expect(sentryOrigin("https://pub@o123.ingest.de.sentry.io/456")).toBe("https://o123.ingest.de.sentry.io");
    expect(sentryOrigin(undefined)).toBeNull();
    expect(sentryOrigin("not a url")).toBeNull();
  });
});
