# Database

PostgreSQL 16 on Supabase. The schema lives in `supabase/migrations`, and the files are applied in order.

| # | Migration | Contents |
|---|---|---|
| 01 | foundation | extensions (`pgcrypto`, `btree_gist`, `citext` in `extensions`), private `app` schema, enums, row triggers |
| 02 | tenancy_identity | currencies, languages, plans, coupons, announcements, profiles, platform_admins, tenants (+settings, branding, domains, subscriptions), feature_flags, RBAC tables, memberships |
| 03 | authz_helpers | permission catalogue, role grants, `app.has_permission` and friends |
| 04 | fleet | branches, one-way fees, vehicle classes, vehicles, images, features, documents, status history, **availability blocks (exclusion constraint)**, transfers |
| 05 | customers_pricing | customers, licences, documents, restrictions, notes, favorites, tax rules, seasonal rates, pricing rules, discount codes, extras |
| 06 | bookings | bookings, status history, vehicle assignments, extras, price lines, notes, state machine + triggers |
| 07 | payments | payment accounts, methods, payments, transactions, refunds (+guard), deposits, invoices, webhook events, idempotency keys, platform fees |
| 08 | operations | agreement templates, rental agreements, signatures, consent, inspections (+offline version guard), photos, damages, AI assessments, maintenance (+auto-blocking), expenses |
| 09 | engagement_audit | notification templates, preferences, push tokens, notifications, reviews (+verification), replies, messaging, privacy requests, **append-only audit log** with PII redaction |
| 10 | rls | RLS on all tables, policies, column-guard triggers, grants |
| 11 | engine | platform settings, onboarding (`create_tenant`), invitations, tenant resolution, public catalogue view, availability, `create_booking`, `record_booking_payment`, `transition_booking`, `assign_booking_vehicle`, hold expiry |
| 12 | storage | buckets (public marketing media; private documents/IDs/inspections) + path-scoped policies |
| 13 | reference_data | currencies (EUR, USD, GBP, ALL, CHF), languages (en, sq), plans, default flags, default notification templates |
| 14 | session_rpcs | `my_memberships`, `am_platform_admin`, legal documents RPC, webhook helper |

## Conventions

- **Primary keys** are `uuid` (`gen_random_uuid()`). History tables use `bigint identity`.
- **Timestamps** are `timestamptz` in UTC. `created_at` and `updated_at` are maintained by the `app.set_updated_at` trigger.
- **Money** is stored as `bigint` minor units plus a `char(3)` currency. Every amount has a `CHECK (>= 0)`, except signed price lines, where discounts are negative.
- **Tenant scoping**: every tenant-owned table has a non-null `tenant_id`.
  - Child tables reference parents through composite keys `(tenant_id, parent_id)`, so cross-tenant links are impossible.
  - `tenant_id` cannot be updated (`app.freeze_tenant_id`).
- **Delete behaviour**:
  - Configuration cascades from the tenant.
  - Financial and operational records use `ON DELETE RESTRICT`, so a tenant with bookings or payments cannot be hard-deleted. Archive it instead (`status = 'ARCHIVED'`).
- **Every table has RLS enabled.** Access is described in [SECURITY.md](SECURITY.md) and [ARCHITECTURE.md §E](ARCHITECTURE.md#e-tenant--rls-security-model).

## Availability model

`vehicle_availability_blocks` is the single source of occupancy:
- **BOOKING** blocks are created by `create_booking` and `assign_booking_vehicle`. Their `period` is `[start, end + tenant buffer)`.
- **MAINTENANCE and CLEANING** blocks are created automatically from `maintenance_records`.
- **TRANSFER** blocks are created from `vehicle_transfers`.
- **MANUAL** blocks are created by staff with `vehicles.status`.
- A block stops occupying the vehicle when `released_at` is set.
- Unpaid holds carry `hold_expires_at` and are released by `release_expired_holds()`. That function runs on a schedule and also before every booking attempt.

The constraint `vehicle_blocks_no_overlap` (`EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (released_at IS NULL)`) makes an overlapping insert fail, whichever transaction commits second. This is proven by `packages/database/test/concurrency.test.ts`: 20 parallel transactions race for the same car, and exactly 1 wins.

## Local and CI database without Docker

`supabase/tests/shim/supabase_shim.sql` emulates the parts of Supabase the migrations rely on:
- the `anon`, `authenticated` and `service_role` roles
- `auth.users`, `auth.uid()` and `auth.role()`, which read `request.jwt.claims` exactly like Supabase does
- the `storage` schema

With it, the real migrations and RLS policies can be tested on stock PostgreSQL:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres scripts/db-reset-local.sh my_db --seed
```

## Backups and recovery

> Nothing below exists until you configure it for your project. The repository does not provision backups.

| Concern | Strategy |
|---|---|
| Database backups | Supabase Pro and above include daily backups. Enable **Point-in-Time Recovery** for production (RPO of minutes). Also run a nightly logical `pg_dump` from a secure runner to storage you control, in a separate account or region, with retention of at least 30 days. |
| Restore | Restore PITR into a *new* project, verify it, then repoint the environment variables. Test a restore at least quarterly and record the RTO. |
| Storage | Supabase Storage objects are **not** part of database backups. Replicate the private buckets (`documents`, `customer-documents`, `inspection-photos`) to an external bucket with versioning and object lock, respecting data-retention settings. |
| Migration rollback | Migrations are forward-only. Every migration that alters or drops data needs a written reverse migration in its PR. CI blocks destructive statements unless the PR has the `destructive-migration-approved` label. To roll back, apply the reverse migration, or restore PITR to just before the deploy. |
| Deploys | Migrations run only through the manual `deploy-database.yml` workflow against a protected GitHub environment. It runs `supabase db push --dry-run` first. |
