/** Report an error caught by a client error boundary (no-op without NEXT_PUBLIC_SENTRY_DSN). */
export function reportClientError(error: unknown) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error)).catch(() => undefined);
}
