/**
 * Notification rendering + channel adapters. Templates are resolved tenant →
 * platform default, in the recipient's language with English fallback, and
 * rendered with HTML escaping for email bodies.
 */

export type Channel = "IN_APP" | "PUSH" | "EMAIL" | "SMS";

export interface Template {
  tenantId: string | null;
  event: string;
  channel: Channel;
  language: string;
  subject: string | null;
  body: string;
  isActive: boolean;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Replace {{name}} placeholders. Unknown placeholders render empty (never leak template syntax). */
export function render(template: string, vars: Record<string, string | number>, opts: { html: boolean }): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return "";
    return opts.html ? escapeHtml(String(v)) : String(v);
  });
}

export function resolveTemplate(templates: readonly Template[], q: { tenantId: string; event: string; channel: Channel; language: string }): Template | null {
  const candidates = templates.filter((t) => t.isActive && t.event === q.event && t.channel === q.channel);
  const order = [
    (t: Template) => t.tenantId === q.tenantId && t.language === q.language,
    (t: Template) => t.tenantId === null && t.language === q.language,
    (t: Template) => t.tenantId === q.tenantId && t.language === "en",
    (t: Template) => t.tenantId === null && t.language === "en",
  ];
  for (const match of order) {
    const found = candidates.find(match);
    if (found) return found;
  }
  return null;
}

export interface OutboundMessage {
  to: string;
  subject?: string;
  text: string;
  html?: string;
  fromName?: string;
  data?: Record<string, string>;
}

export interface ChannelSender {
  readonly channel: Channel;
  send(message: OutboundMessage): Promise<{ providerMessageId: string }>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, res.status >= 500 || res.status === 429);
  return json;
}

/** Email via Resend (https://resend.com). Requires RESEND_API_KEY and a verified sending domain. */
export class ResendEmailSender implements ChannelSender {
  readonly channel = "EMAIL" as const;
  constructor(private readonly apiKey: string, private readonly fromAddress: string) {}
  async send(m: OutboundMessage) {
    const json = await postJson("https://api.resend.com/emails", {
      from: m.fromName ? `${m.fromName} <${this.fromAddress}>` : this.fromAddress,
      to: [m.to], subject: m.subject ?? "", text: m.text, ...(m.html ? { html: m.html } : {}),
    }, { authorization: `Bearer ${this.apiKey}` });
    return { providerMessageId: String(json.id ?? "") };
  }
}

/** Push via Expo Push Service. Token format: ExponentPushToken[...] */
export class ExpoPushSender implements ChannelSender {
  readonly channel = "PUSH" as const;
  constructor(private readonly accessToken?: string) {}
  async send(m: OutboundMessage) {
    const json = await postJson("https://exp.host/--/api/v2/push/send",
      { to: m.to, title: m.subject, body: m.text, data: m.data ?? {}, sound: "default" },
      this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {});
    const data = json.data as { id?: string; status?: string; message?: string } | undefined;
    if (data?.status === "error") throw new ProviderError(data.message ?? "Expo push error", false);
    return { providerMessageId: data?.id ?? "" };
  }
}

/** SMS via Twilio (optional per plan). */
export class TwilioSmsSender implements ChannelSender {
  readonly channel = "SMS" as const;
  constructor(private readonly accountSid: string, private readonly authToken: string, private readonly from: string) {}
  async send(m: OutboundMessage) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: m.to, From: this.from, Body: m.text }),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string };
    if (!res.ok) throw new ProviderError(`Twilio HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    return { providerMessageId: json.sid ?? "" };
  }
}

/** Exponential backoff schedule for queued notifications. */
export function nextAttemptDelayMs(attempts: number): number | null {
  if (attempts >= 6) return null; // give up; surfaced to staff/admin as FAILED
  return Math.min(60_000 * 2 ** attempts, 6 * 3_600_000);
}
