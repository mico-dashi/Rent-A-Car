# Security

## Controls in place

| Area | Control | Where |
|---|---|---|
| Tenant isolation | RLS on every table; composite tenant foreign keys; immutable `tenant_id` | migrations 02–10; tests `tenant-isolation.test.ts` |
| Authorization | Granular permissions (`vehicles.write`, `payments.refund`…) per role with per-member overrides; enforced in SQL, repeated server-side for fast rejection, and used by UIs for affordances | `app.has_permission`, `@rental/domain/permissions`, `@rental/auth` |
| Privilege escalation | Guard triggers on memberships (rank), tenants (status/slug/owner), domains (verification), vehicles (operational fields), customers (verification/restriction), documents, damages, notifications | migration 10; `rls.test.ts` |
| Service role | Server-only module (`server-only` import + browser guard); never in mobile; used only after code-level authorization | `apps/web/src/lib/supabase/server.ts` |
| Money integrity | Integer minor units, non-negative checks, immutable price snapshots, refund ≤ captured, damage and late-fee charges require a named approver | migrations 06–07 |
| Idempotency | `idempotency_key` on bookings, payments and refunds; unique webhook events; Stripe idempotency keys derived from the booking key | migrations 06–07, `booking-service.ts` |
| Webhooks | Signature verification on the raw body, test/live mode mismatch rejected, persisted before processing, atomic claim, retry-safe | `@rental/payments/webhooks.ts`, tests |
| Input validation | Zod on every route; RPCs re-validate business rules | `@rental/validation` |
| Rate limiting | Per-IP and per-user limits on quote, booking and identity routes, shared across instances through Upstash Redis (`RATE_LIMIT_REDIS_URL` + `RATE_LIMIT_REDIS_TOKEN`); falls back to a per-instance limiter if Redis is down, so an outage never blocks requests | `@rental/server/rate-limit.ts`, `apps/web/src/lib/http.ts` |
| Auth | Supabase Auth; server always uses `auth.getUser()` (JWT validated with the auth server), never the unverified session; minimum password length 10 with complexity; refresh-token rotation; TOTP MFA enabled in config | `supabase/config.toml` |
| Cookies | httpOnly, SameSite=Lax, Secure in production | `@rental/auth`, middleware |
| Mobile tokens | Stored only in Keychain/Keystore via chunked `expo-secure-store` | `apps/mobile/src/lib/secure-storage.ts` |
| Storage | Private buckets for identity documents, inspections, agreements, invoices; path-scoped policies `<tenant_id>/…`; signed URLs only | migration 12 |
| Audit | Append-only `audit_logs` (actor, tenant, action, before/after, IP, UA, request id); PII tables store changed column names only (`[redacted]`) | migration 09 |
| Headers | Per-request nonce CSP (`'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'` scripts) on web and admin; HSTS (preload), `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, no `x-powered-by` | `@rental/config/csp.ts`, `apps/*/src/middleware.ts`, `apps/*/next.config.ts` |
| Error reporting | Sentry only when a DSN is set; no user info, cookies, bodies or query strings are collected, and a scrubber removes credentials, URL tokens and e-mail addresses | `@rental/config/observability.ts`, `apps/*/src/instrumentation*.ts` |
| Identity verification | Stripe Identity (ID document + live selfie) hosted by the provider; we store only the session id and outcome, and only the session we started can change a customer's status | `@rental/server/payments.ts`, `/api/v1/identity/session` |
| Data retention | Daily job anonymises customers inactive beyond the tenant's `data_retention_days` (once nothing is open or owed), deletes their ID documents, messages and old inspection photos (rows and files); invoices and the audit log are kept | migration 18, `@rental/server/jobs.ts` |
| Dependencies | `pnpm audit --prod --audit-level high` in CI; Dependabot for npm and Actions; unfixable advisories documented in `pnpm-workspace.yaml` | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| Errors | Stable error codes to clients; stack traces logged server-side only | `apps/web/src/lib/http.ts`, `app/error.tsx` |
| Open redirects | Sign-in and callback accept only same-site relative paths | `sign-in/page.tsx`, `auth/callback` |
| Definer functions | Every `SECURITY DEFINER` function pins `search_path` (CI-tested); helpers in the non-exposed `app` schema | `parity.test.ts` |
| Dashboard MFA | Owners, tenant admins and platform admins must enrol TOTP (`ADMIN_MFA_POLICY=privileged`, the production default); anyone enrolled must pass AAL2 each session. Enrolment and verification run server-side | `apps/admin/src/lib/mfa.ts`, `e2e/tests/mfa.spec.ts` |
| Private documents | Agreements, invoices, inspection photos and IDs are served only through short-lived signed URLs minted after an ownership or permission check (customer RLS read, or staff permission per bucket) | `apps/web/src/app/account/documents`, `apps/admin/src/app/t/[tenant]/documents/route.ts` |
| Signatures | Each signature is bound to the SHA-256 of the exact agreement content; a changed agreement rejects old signatures (`SIGNATURE_CONTENT_MISMATCH`) | migration 15, `@rental/server/documents.ts` |
| Offline sync | Stale inspection edits raise `VERSION_CONFLICT` and are parked on the device for the user, never overwritten | migrations 08, 17; `@rental/api-client/inspections.ts` |
| Cron | Scheduled routes require `Bearer CRON_SECRET` (constant-time compare); closed when the secret is unset | `apps/web/src/lib/cron.ts` |
| Privacy | Data export, deletion requests, and platform-side anonymisation (blocked while rentals are active) | migration 16 |
| AI damage | Advisory only; stored with confidence and review status; cannot produce a charge | `damage_ai_assessments` |
| Employee monitoring | No location tracking or surveillance features; activity is limited to operational audit events | by design |

## Open items before production

1. **Supabase Auth hardening (project settings, not code).** Turn on CAPTCHA (hCaptcha or Turnstile) for sign-up and password sign-in, and review the Auth rate limits in the Supabase dashboard.
2. **Penetration test** by an independent party before go-live.
3. **Production credentials exercised end to end.** Stripe (payments, Connect, Identity), Resend, Expo push, Twilio and Sentry are implemented and tested against test doubles and signed-webhook fixtures, but have not run with real keys.
4. **Expo CLI advisories.** `node-forge` and `braces` advisories have no patched release; they only affect developer and build machines. Re-check on each Expo SDK upgrade (`auditConfig` in `pnpm-workspace.yaml`).

## Reporting

Report vulnerabilities privately to the platform security contact. Do not open public issues.
