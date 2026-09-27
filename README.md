# Rental Platform — white-label car rental SaaS

A multi-tenant platform that rental companies can license. It gives each company a branded booking website on a platform subdomain or its own domain. Customers can also book through one universal iOS/Android app, or through optional branded app builds. Behind this sit a booking engine that cannot double-book, a rule-based pricing engine, Stripe payments with deposits, and tenant isolation enforced by PostgreSQL Row Level Security.

> **Status:** early build. The database, security model, booking/pricing engines, customer storefront and mobile white-label foundation are implemented and tested. The owner/staff/super-admin dashboards, PDF agreements, analytics and E2E tests are **not built yet**. See the phase-by-phase status in [docs/ARCHITECTURE.md#g](docs/ARCHITECTURE.md#g-implementation-roadmap--status). Do not deploy to production yet.

| Doc | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, folders, ERD, booking state machine, RLS model, payment flow, roadmap |
| [DATABASE.md](docs/DATABASE.md) | Tables, invariants, migrations, backups, rollback |
| [SECURITY.md](docs/SECURITY.md) | Threat model, controls, open items |
| [PAYMENTS.md](docs/PAYMENTS.md) | Stripe setup, deposits, refunds, webhooks, commission |
| [WHITE_LABEL.md](docs/WHITE_LABEL.md) | Tenants, domains, branded apps, app-store strategy |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Web, database, iOS, Android, custom domains, production checklist |
| [TESTING.md](docs/TESTING.md) | Test suites and how to run them |
| [API.md](docs/API.md) | HTTP routes and database RPCs |

## Prerequisites

- Node.js ≥ 20.11 (CI uses 22) and pnpm 10 (`corepack enable`)
- For the full local stack: Docker plus the [Supabase CLI](https://supabase.com/docs/guides/cli)
- To run only the DB test suite: any PostgreSQL 15+ server with `psql`. Docker is not needed.
- Mobile: Expo tooling via `npx expo`, an [EAS](https://expo.dev/eas) account for store builds, Xcode (iOS) and Android Studio (Android) for local native runs

## Installation

```bash
pnpm install
cp .env.example apps/web/.env.local       # fill in values, see "Environment variables"
cp .env.example apps/mobile/.env
```

## Local development

### 1. Supabase

```bash
supabase start                 # starts Postgres, Auth, Storage, PostgREST locally (Docker)
supabase db reset              # applies supabase/migrations/* and supabase/seed.sql
supabase status                # prints the API URL, anon key and service_role key
```

Put the printed URL and keys into `apps/web/.env.local`:
- the URL into `NEXT_PUBLIC_SUPABASE_URL`
- the anon key into `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- the service_role key into `SUPABASE_SERVICE_ROLE_KEY`

**Migrations.** Add new files as `supabase/migrations/<timestamp>_<name>.sql` (`supabase migration new <name>`). Never edit a migration that has already been applied to a shared environment. Add a new one instead.

**Seed.** `supabase/seed.sql` creates the demo tenant **Apex Drive Rentals**:
- 2 branches (City Center, Airport) and 8 vehicles
- pricing rules, extras and VAT
- demo users, all with the password `DemoPassw0rd!` (local only):

| Email | Role |
|---|---|
| `admin@platform.demo` | platform super admin |
| `owner@apexdrive.demo` | tenant owner |
| `staff@apexdrive.demo` | employee |
| `customer@example.demo` | customer |

### 2. Web

```bash
pnpm --filter @rental/web dev          # http://localhost:3000
```

Tenants are resolved from the `Host` header. In development, plain `localhost` serves `DEV_TENANT_SLUG` (default `apex-drive`). `http://apex-drive.localhost:3000` also works, exactly like a production subdomain would. Unknown hosts return 404.

### 3. Mobile

```bash
cd apps/mobile
npx expo start                          # universal app (APP_VARIANT=universal)
APP_VARIANT=apex-drive npx expo start   # branded build of the demo tenant
```

In the universal app, enter tenant code `APEX01`, or open `rentalplatform://t/apex-drive`.

### Useful commands

```bash
pnpm turbo run lint typecheck test      # all packages
pnpm test:db                            # DB integration suite (needs DATABASE_URL to a Postgres server)
pnpm --filter @rental/web build
node apps/mobile/scripts/check-variants.mjs
```

## Environment variables

Every variable is documented in [`.env.example`](.env.example). Server variables are validated at runtime by `@rental/config`. When one is missing, the error names it but never prints its value.

- `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` values are shipped to clients and must never contain secrets.
- `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only.

## Builds and deployment

| Task | Guide |
|---|---|
| Web deployment (Vercel or Node) | [DEPLOYMENT.md#web](docs/DEPLOYMENT.md#web) |
| Database migrations to staging/production | [DEPLOYMENT.md#database](docs/DEPLOYMENT.md#database) |
| EAS, iOS and Android builds | [DEPLOYMENT.md#mobile-eas](docs/DEPLOYMENT.md#mobile-eas) |
| Custom domain setup | [DEPLOYMENT.md#custom-domains](docs/DEPLOYMENT.md#custom-domains) |
| Adding a new tenant | [WHITE_LABEL.md#adding-a-new-tenant](docs/WHITE_LABEL.md#adding-a-new-tenant) |
| Adding a white-label client app | [WHITE_LABEL.md#adding-a-white-label-client](docs/WHITE_LABEL.md#adding-a-white-label-client) |

## Legacy

`rental car company/` contains the original static marketing page that was in this repository before the platform. It is kept untouched and is not part of the build.
