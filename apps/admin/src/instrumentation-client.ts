import { SENTRY_DATA_COLLECTION, scrubEvent } from "@rental/config/observability";

/** Browser error reporting; the SDK is only downloaded when NEXT_PUBLIC_SENTRY_DSN is set. */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({ dsn, dataCollection: SENTRY_DATA_COLLECTION, tracesSampleRate: 0, beforeSend: (event) => scrubEvent(event) });
  });
}
