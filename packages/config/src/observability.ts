/**
 * Privacy scrubbing for error reports (Sentry `beforeSend`). Reports must
 * never carry credentials or customer PII: cookies, auth headers, query
 * strings with tokens, and e-mail addresses are removed. Dependency-free so
 * both apps (server, edge and browser) can share it.
 */
type Loose = Record<string, unknown>;

const SECRET_HEADERS = /^(cookie|set-cookie|authorization|apikey|x-supabase-.*|stripe-signature|x-api-key)$/i;
const SECRET_PARAMS = /^(token|code|access_token|refresh_token|key|secret|password|signature|sig)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function scrubUrl(url: string): string {
  try {
    const u = new URL(url, "http://x");
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAMS.test(k)) u.searchParams.set(k, "[redacted]");
    return url.startsWith("http") ? u.toString() : `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function scrubText<T>(v: T): T {
  return (typeof v === "string" ? v.replace(EMAIL, "[email]") : v) as T;
}

export function scrubEvent<E extends object>(event: E): E {
  const e = event as unknown as Loose;
  delete e.user;
  const req = e.request as Loose | undefined;
  if (req) {
    delete req.cookies;
    delete req.data;
    if (typeof req.url === "string") req.url = scrubUrl(req.url);
    if (typeof req.query_string === "string") req.query_string = "[redacted]";
    const h = req.headers as Record<string, string> | undefined;
    if (h) for (const k of Object.keys(h)) if (SECRET_HEADERS.test(k)) h[k] = "[redacted]";
  }
  if (typeof e.message === "string") e.message = scrubText(e.message);
  const values = ((e.exception as Loose | undefined)?.values ?? []) as Loose[];
  for (const v of values) if (typeof v.value === "string") v.value = scrubText(v.value);
  const crumbs = (e.breadcrumbs ?? []) as Loose[];
  for (const b of crumbs) {
    if (typeof b.message === "string") b.message = scrubText(b.message);
    const d = b.data as Loose | undefined;
    if (d && typeof d.url === "string") d.url = scrubUrl(d.url);
  }
  return event;
}

/** Ingest origin of a Sentry DSN (for CSP connect-src), or null. */
export function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

/**
 * Sentry `dataCollection`: collect no user identity, cookies, bodies or query
 * strings, and only non-sensitive request headers. `scrubEvent` remains the
 * last line of defence for anything captured anyway.
 */
export const SENTRY_DATA_COLLECTION: {
  userInfo: boolean; cookies: boolean; httpHeaders: { request: { allow: string[] }; response: boolean }; httpBodies: never[]; urlQueryParams: boolean;
} = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent", "content-type", "accept-language"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
};
