# Testing

| Suite | Command | What it proves |
|---|---|---|
| Unit: domain | `pnpm --filter @rental/domain test` | Money math (BigInt, no floats), base-rate tiers, the pricing engine (itemisation, weekend/seasonal rules in the branch timezone, DST, discounts, tax inclusive/exclusive, dynamic floor/ceiling, no negative totals, determinism), return charges, cancellation fees, state machine, availability and utilization, permissions and escalation rules, timezone conversion incl. DST gaps and overlaps |
| Unit: payments | `pnpm --filter @rental/payments test` | Webhook signature rejection (missing, forged, tampered), exactly-once processing across retries, 500 on handler failure then recovery, live/test mode guard, deposit strategy, capture caps, commission kinds |
| Unit: other | `pnpm turbo run test` | Rate limiter (Redis pipeline, shared counts, fallback on outage), CSP builder (nonce, no unsafe-inline), error-report scrubbing, Stripe Identity event normalisation, localization (Albanian covers every English key, plurals, money, timezones), design tokens (WCAG contrast for any brand colour), notifications (HTML escaping, template fallback, backoff), maps (distance, nearest branch, delivery fees) |
| DB integration | `DATABASE_URL=… pnpm test:db` | Runs the real migrations and seed against PostgreSQL, then checks: **tenant isolation** (Tenant A cannot read, insert, update, delete or cross-reference Tenant B data in 17 private tables), **RLS and column guards**, the **booking engine** (buffers, idempotency, money invariants, maintenance blocking, hold expiry, payment confirmation, pickup gates, immutable snapshots, cancellation fees, class capacity and substitution, onboarding, tenant resolution), **concurrency** (20 simultaneous bookings for one car → exactly 1 succeeds; class capacity 2 under 12 racers → exactly 2), **data retention** (anonymise only inactive, settled customers; idempotent; service-only), **location discovery** (flag off/on, radius, tenant opt-out, suspended tenants hidden), and **parity** (TS state machine, permissions and enums equal the SQL; RLS on all tables; pinned `search_path`) |
| Stack services | `pnpm stack:up` then `pnpm test:stack` | `@rental/server` against real PostgREST, GoTrue and the RLS-enforcing storage emulator: staff bookings and re-pricing, agreement PDFs with hash-bound signatures, gap-free invoice numbers, refunds (once, never over-refund), notification dispatch, the scheduler tick (isolated jobs, domain verification), data retention (customer anonymised and stored files really deleted), Stripe Identity (pending, then verified only by our own session), offline inspection sync as a real staff user (create, lost-response retry, version conflict, acceptance gate, idempotent photo upload, customers denied), storage RLS |
| E2E (Playwright) | stack + `pnpm --filter @rental/web start` + `pnpm --filter @rental/admin start`, then `pnpm test:e2e` | Every dashboard section renders with no server error or raw i18n key (English and Albanian); walk-in booking through the engine; expense entry; staff and customer permission boundaries; platform console; TOTP enrolment then challenge on the next session; storefront pages, search and vehicle detail on the tenant host; unknown hosts 404; customer data export and identity-verification entry point; cron authorisation; nonce CSP header, nonce stamping and rotation |
| Translations | `pnpm --filter @rental/localization test` | Albanian covers every English key; every key used in `apps/admin` and `apps/mobile` (static and enumerated dynamic keys) exists in both; every business error code has a message |
| Mobile logic | `pnpm --filter @rental/mobile test` | Offline outbox ordering, network stop/resume, conflicts parked (never overwritten) and re-based on request, rejections, concurrency, corrupted storage; fleet QR parsing |
| Build | `pnpm --filter @rental/web build`, `pnpm --filter @rental/admin build`, `npx expo export` in `apps/mobile` | Web and admin compile with strict types and lint; iOS and Android JS bundles build |
| Mobile config | `node apps/mobile/scripts/check-variants.mjs` | Every white-label client resolves to a valid, unique Expo config |

The DB suite runs in CI against a `postgres:16` service container (see `.github/workflows/ci.yml`). Every test transaction is rolled back, except the concurrency tests, which commit on a disposable database. The `stack-e2e` CI job downloads the PostgREST and GoTrue binaries, starts `tools/local-stack`, and runs the stack services and Playwright suites.

### Running the local stack (no Docker)

```bash
bash tools/local-stack/fetch-binaries.sh                           # PostgREST + Supabase Auth binaries (Linux x64)
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm stack:fresh   # new DB: migrations + seed, gateway on :54321
set -a; . tools/local-stack/.data/stack.env; set +a                # URL + anon/service keys for local use only
```

Write the `NEXT_PUBLIC_*` and `SUPABASE_*` lines of `stack.env` into `apps/web/.env.local` and `apps/admin/.env.local` (plus `CRON_SECRET` for the web app, and `ADMIN_MFA_POLICY=enrolled` for the admin app), build and start both apps, then run `pnpm test:e2e`. The storefront is served at `http://apex-drive.localhost:3000` in production mode. Stack tests and E2E use randomised date windows, so they can be re-run against the same database.

## Not yet covered

- **Card payment E2E** (Stripe test mode: pay → webhook → confirmed → refund). Needs Stripe test keys and `stripe listen`; the payment code is tested with a provider test double and signed-webhook unit tests.
- **Native mobile UI tests** (Maestro or Detox). Mobile logic is unit-tested and the sync layer is tested against the stack; screens are verified by bundling for iOS and Android.
