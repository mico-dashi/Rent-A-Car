import type { SupabaseClient } from "@rental/auth";
import { formatDateTime, formatMoney } from "@rental/localization";
import { nextAttemptDelayMs, ProviderError, render, resolveTemplate, type ChannelSender, type Template } from "@rental/notifications";
import type { CurrencyCode, LanguageCode } from "@rental/types";

type Row = Record<string, unknown>;

export interface Senders {
  EMAIL?: ChannelSender;
  PUSH?: ChannelSender;
  SMS?: ChannelSender;
}

/** Turn raw event data into display variables in the recipient's language and the branch timezone. */
function variables(data: Row, lang: LanguageCode, tenantName: string): Record<string, string | number> {
  const tz = (data.timezone as string | undefined) ?? "UTC";
  const out: Record<string, string | number> = { tenant: tenantName };
  for (const [k, v] of Object.entries(data)) if (typeof v === "string" || typeof v === "number") out[k] = v;
  if (typeof data.pickupAt === "string") out.pickupAt = formatDateTime(data.pickupAt, tz, lang, "medium");
  if (typeof data.returnAt === "string") out.returnAt = formatDateTime(data.returnAt, tz, lang, "medium");
  if (typeof data.totalMinor === "number" && typeof data.currency === "string") out.total = formatMoney(data.totalMinor, data.currency as CurrencyCode, lang);
  if (typeof data.amountMinor === "number" && typeof data.currency === "string") out.amount = formatMoney(data.amountMinor, data.currency as CurrencyCode, lang);
  return out;
}

/**
 * Process due notifications. IN_APP rows are marked delivered immediately;
 * EMAIL/PUSH/SMS go through the configured senders. Missing channel
 * configuration or missing recipient leads to FAILED (visible to admins),
 * never to a silent success.
 */
export async function dispatchNotifications(db: SupabaseClient, senders: Senders, limit = 100) {
  const { data: due, error } = await db.from("notifications").select("*").eq("status", "QUEUED").lte("send_after", new Date().toISOString())
    .order("send_after").limit(limit);
  if (error) throw new Error(error.message);
  const rows = (due ?? []) as Row[];
  if (!rows.length) return { sent: 0, failed: 0, retried: 0 };

  const tenantIds = [...new Set(rows.map((r) => r.tenant_id).filter(Boolean))] as string[];
  const [{ data: templates }, { data: tenants }, { data: branding }] = await Promise.all([
    db.from("notification_templates").select("*").or(`tenant_id.is.null,tenant_id.in.(${tenantIds.join(",") || "00000000-0000-0000-0000-000000000000"})`),
    db.from("tenants").select("id,display_name,default_language").in("id", tenantIds.length ? tenantIds : ["00000000-0000-0000-0000-000000000000"]),
    db.from("tenant_branding").select("tenant_id,email_from_name,email_footer").in("tenant_id", tenantIds.length ? tenantIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const tpl: Template[] = ((templates ?? []) as Row[]).map((t) => ({
    tenantId: (t.tenant_id as string | null) ?? null, event: t.event as string, channel: t.channel as Template["channel"], language: t.language as string,
    subject: (t.subject as string | null) ?? null, body: t.body as string, isActive: Boolean(t.is_active),
  }));
  const tmap = new Map(((tenants ?? []) as Row[]).map((t) => [t.id, t]));
  const bmap = new Map(((branding ?? []) as Row[]).map((b) => [b.tenant_id, b]));

  let sent = 0, failed = 0, retried = 0;
  for (const n of rows) {
    const tenant = tmap.get(n.tenant_id) as Row | undefined;
    const { data: cust } = n.user_id && n.tenant_id
      ? await db.from("customers").select("preferred_language,phone").eq("tenant_id", n.tenant_id).eq("user_id", n.user_id).maybeSingle()
      : { data: null };
    const lang = ((cust?.preferred_language ?? tenant?.default_language) === "sq" ? "sq" : "en") as LanguageCode;
    const template = resolveTemplate(tpl, { tenantId: (n.tenant_id as string) ?? "", event: n.event as string, channel: n.channel as Template["channel"], language: lang })
      ?? (n.channel === "IN_APP" || n.channel === "PUSH" ? resolveTemplate(tpl, { tenantId: (n.tenant_id as string) ?? "", event: n.event as string, channel: "EMAIL", language: lang }) : null);
    const vars = variables((n.data ?? {}) as Row, lang, (tenant?.display_name as string) ?? "");
    const title = template?.subject ? render(template.subject, vars, { html: false }) : (n.event as string);
    const text = template ? render(template.body, vars, { html: false }) : (n.event as string);
    const done = async (patch: Row) => { await db.from("notifications").update(patch).eq("id", n.id); };

    try {
      if (n.channel === "IN_APP") {
        await done({ status: "DELIVERED", title, body: text, sent_at: new Date().toISOString() });
        sent++;
        continue;
      }
      const sender = senders[n.channel as keyof Senders];
      if (!sender) { await done({ status: "FAILED", title, body: text, error: `channel ${String(n.channel)} not configured` }); failed++; continue; }
      let to: string | null = null;
      if (n.channel === "EMAIL") to = (n.recipient_address as string | null) ?? null;
      if (n.channel === "SMS") to = (cust?.phone as string | null) ?? null;
      if (n.channel === "PUSH") {
        const { data: tokens } = await db.from("push_tokens").select("token").eq("user_id", n.user_id).order("last_seen_at", { ascending: false }).limit(1);
        to = ((tokens ?? [])[0] as Row | undefined)?.token as string | undefined ?? null;
      }
      if (!to) { await done({ status: "FAILED", title, body: text, error: "no recipient" }); failed++; continue; }
      const b = bmap.get(n.tenant_id) as Row | undefined;
      const footer = (b?.email_footer as string | null) ?? "";
      const res = await sender.send({
        to, subject: title, text: footer ? `${text}\n\n${footer}` : text,
        ...(n.channel === "EMAIL" && template ? { html: `<p>${render(template.body, vars, { html: true })}</p>${footer ? `<p style="color:#666">${render(footer, {}, { html: true })}</p>` : ""}` } : {}),
        ...(b?.email_from_name ? { fromName: b.email_from_name as string } : {}),
        data: Object.fromEntries(Object.entries((n.data ?? {}) as Row).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string])),
      });
      await done({ status: "SENT", title, body: text, provider_message_id: res.providerMessageId, sent_at: new Date().toISOString(), attempts: Number(n.attempts) + 1 });
      sent++;
    } catch (e) {
      const attempts = Number(n.attempts) + 1;
      const delay = e instanceof ProviderError && !e.retryable ? null : nextAttemptDelayMs(attempts);
      if (delay === null) { await done({ status: "FAILED", attempts, error: (e as Error).message.slice(0, 300) }); failed++; }
      else { await done({ attempts, error: (e as Error).message.slice(0, 300), send_after: new Date(Date.now() + delay).toISOString() }); retried++; }
    }
  }
  return { sent, failed, retried };
}
