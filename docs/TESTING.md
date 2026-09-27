# Testing

| Suite | Command | What it proves |
|---|---|---|
| Unit: domain | `pnpm --filter @rental/domain test` | Money math (BigInt, no floats), base-rate tiers, the pricing engine (itemisation, weekend/seasonal rules in the branch timezone, DST, discounts, tax inclusive/exclusive, dynamic floor/ceiling, no negative totals, determinism), return charges, cancellation fees, state machine, availability and utilization, permissions and escalation rules, timezone conversion incl. DST gaps and overlaps |
| Unit: payments | `pnpm --filter @rental/payments test` | Webhook signature rejection (missing, forged, tampered), exactly-once processing across retries, 500 on handler failure then recovery, live/test mode guard, deposit strategy, capture caps, commission kinds |
| Unit: other | `pnpm turbo run test` | Localization (Albanian covers every English key, plurals, money, timezones), design tokens (WCAG contrast for any brand colour), notifications (HTML escaping, template fallback, backoff), maps (distance, nearest branch, delivery fees) |
| DB integration | `DATABASE_URL=… pnpm test:db` | Runs the real migrations and seed against PostgreSQL, then checks: **tenant isolation** (Tenant A cannot read, insert, update, delete or cross-reference Tenant B data in 17 private tables), **RLS and column guards**, the **booking engine** (buffers, idempotency, money invariants, maintenance blocking, hold expiry, payment confirmation, pickup gates, immutable snapshots, cancellation fees, class capacity and substitution, onboarding, tenant resolution), **concurrency** (20 simultaneous bookings for one car → exactly 1 succeeds; class capacity 2 under 12 racers → exactly 2), and **parity** (TS state machine, permissions and enums equal the SQL; RLS on all tables; pinned `search_path`) |
| Build | `pnpm --filter @rental/web build` | Web app compiles with strict types and lint |
| Mobile config | `node apps/mobile/scripts/check-variants.mjs` | Every white-label client resolves to a valid, unique Expo config |

The DB suite runs in CI against a `postgres:16` service container (see `.github/workflows/ci.yml`). Every test transaction is rolled back, except the concurrency tests, which commit on a disposable database.

## Not yet implemented

- **E2E customer flow** (Playwright): register → search → book → pay (Stripe test mode) → see reservation → cancel. Needs a full Supabase stack plus Stripe test keys.
- **E2E owner and super-admin flows.** Blocked on the dashboards (Phases 13 and 19).
- **Mobile UI tests** (Maestro or Detox).
