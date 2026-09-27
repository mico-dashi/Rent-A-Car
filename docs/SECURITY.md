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
| Rate limiting | Per-IP and per-user limits on quote and booking routes | `apps/web/src/lib/http.ts` — **in-memory; see open items** |
| Auth | Supabase Auth; server always uses `auth.getUser()` (JWT validated with the auth server), never the unverified session; minimum password length 10 with complexity; refresh-token rotation; TOTP MFA enabled in config | `supabase/config.toml` |
| Cookies | httpOnly, SameSite=Lax, Secure in production | `@rental/auth`, middleware |
| Mobile tokens | Stored only in Keychain/Keystore via chunked `expo-secure-store` | `apps/mobile/src/lib/secure-storage.ts` |
| Storage | Private buckets for identity documents, inspections, agreements, invoices; path-scoped policies `<tenant_id>/…`; signed URLs only | migration 12 |
| Audit | Append-only `audit_logs` (actor, tenant, action, before/after, IP, UA, request id); PII tables store changed column names only (`[redacted]`) | migration 09 |
| Headers | CSP, HSTS (preload), `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, no `x-powered-by` | `apps/web/next.config.ts` |
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

1. **Distributed rate limiting.** Replace the in-memory limiter with Redis or Upstash (`RATE_LIMIT_REDIS_URL`) when running more than one instance. Also add Supabase Auth rate limits and CAPTCHA on sign-up.
2. **CSP nonces.** `script-src` currently allows `'unsafe-inline'` for Next.js hydration. Move to nonce-based CSP.
3. **Identity verification adapters** (Stripe Identity, Persona or Veriff) are not implemented yet. Manual verification by staff with `customers.documents` works.
4. **Sentry wiring.** The DSN variables exist, but the SDK is not initialised yet.
5. **Data retention job.** `tenant_settings.data_retention_days` is stored but not enforced yet.
6. **Penetration test** and dependency scanning (Dependabot, `pnpm audit`) in CI.

## Reporting

Report vulnerabilities privately to the platform security contact. Do not open public issues.
