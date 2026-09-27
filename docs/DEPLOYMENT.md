# Deployment

> No environment is provisioned by this repository. These steps describe how to do it. Keep all secrets in your hosting provider's secret store, never in git.

## Environments

| Environment | Supabase project | Web | Stripe |
|---|---|---|---|
| development | local (`supabase start`) | `pnpm dev` | test keys + `stripe listen` |
| staging/preview | separate project | preview deployments | test mode |
| production | separate project with PITR | production deployment | live mode, after the go-live checklist |

## Database

1. Create the Supabase project. Enable PITR in production.
2. Configure Auth:
   - site URL and redirect URLs, including `https://*.myplatform.com/auth/callback` and each custom domain
   - SMTP for auth emails
   - Google and Apple providers, if used
   - CAPTCHA
3. Run migrations only through GitHub Actions → **Deploy database migrations** (`workflow_dispatch`):
   - choose the environment
   - the GitHub environment should require reviewer approval
   - the workflow runs `supabase db push --dry-run`, then `supabase db push`
4. **Never run `seed.sql` in production.** Reference data ships in migration 13.
5. Set `platform_settings.root_domain` to your platform domain.
6. Schedule the jobs (both accept GET or POST with `Authorization: Bearer $CRON_SECRET`; `apps/web/vercel.json` declares them for Vercel Cron, which sends that header automatically when `CRON_SECRET` is set):
   - `/api/v1/cron/release-holds` every minute: releases expired unpaid holds.
   - `/api/v1/cron/tick` every 5 minutes: overdue/no-show housekeeping and reminders, deposit authorisations, cancellation refunds, notification delivery (email/push/SMS) and custom-domain verification. It returns `207` with per-job results when any job failed; each job is idempotent and isolated.
   - Vercel Hobby only allows daily crons; use Pro, or call the routes from GitHub Actions or another scheduler.

## Web

Vercel is recommended. Any Node 22 host that runs `next start` also works.

- **Root directory:** `apps/web`. Build command: `pnpm --filter @rental/web build`. Install command: `pnpm install --frozen-lockfile`.
- **Environment variables:** every variable in `.env.example` marked for web. `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `CRON_SECRET` must be server-only (not `NEXT_PUBLIC_`).
- **Domains:** add the apex `myplatform.com` and the wildcard `*.myplatform.com`. Vercel issues wildcard certificates when its nameservers are used.
- **Promotion:** deploy previews for pull requests, and promote to production only after CI (lint, typecheck, unit, DB integration, build) is green.

## Admin dashboard

`apps/admin` is a separate Next.js app for owners, staff and platform admins. Deploy it as its own project (for example `admin.myplatform.com`), never on tenant domains.

- **Root directory:** `apps/admin`. Build command: `pnpm --filter @rental/admin build`.
- **Environment variables:** the Supabase and Stripe variables from `.env.example`, `NEXT_PUBLIC_ADMIN_URL`, and `ADMIN_MFA_POLICY` (leave unset for the production default, `privileged`).
- Add `https://admin.myplatform.com/auth/callback` to the Supabase Auth redirect allow-list.
- Owners, tenant admins and platform admins are sent to `/mfa` to enrol TOTP on first sign-in, and must pass it on every new session.

## Custom domains

1. The tenant owner adds `rentals.example.com` in the dashboard (**Website → Domains**), which inserts a row into `tenant_domains`. The owner then creates two DNS records:
   - `CNAME rentals.example.com → cname.myplatform.com` (or `A` records for an apex domain)
   - `TXT _rental-verify.rentals.example.com → <verification_token>`
2. The verification job (part of `/api/v1/cron/tick`) checks the TXT record. On success it:
   - adds the domain to the hosting provider through the Vercel Domains API (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID`), which issues TLS
   - then sets `status = 'VERIFIED'` and `verified_at` using the service role (tenants cannot set these themselves, because a DB guard stops them)

   Domains still unverified after 14 days are marked `FAILED`. Without Vercel credentials the job only verifies DNS; attach the domain to your host manually. Platform admins can also mark a domain verified in **Platform → Tenants**.
3. Add `https://rentals.example.com/auth/callback` to the Supabase Auth redirect allow-list.
4. `resolve_tenant` now serves the tenant on that host. Canonical URLs and the sitemap use the domain marked `is_primary`.

## Mobile (EAS)

1. Run `npm i -g eas-cli`, then `eas login`, then `cd apps/mobile && eas init`, and put the `projectId` into the client config (`easProjectId`).
2. Set build-time variables as EAS environment variables:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_API_BASE_URL`
3. Build with the profiles in `eas.json`:

| Profile | Use |
|---|---|
| `development` | dev client for simulators and devices |
| `preview` | internal distribution (TestFlight internal / APK) |
| `production` | store builds; build numbers auto-increment |
| `<client>-preview` / `<client>-production` | branded builds (`APP_VARIANT=<client>`) |

### iOS

1. Have an Apple Developer Program membership. The bundle id comes from the client config (`.development` and `.preview` suffixes for non-production).
2. Build with `eas build --profile production --platform ios`. EAS manages certificates and profiles.
3. Associated domains: host `/.well-known/apple-app-site-association` on each domain in `associatedDomains`, listing `/t/*`.
4. Submit with `eas submit --platform ios`, then fill in the App Store privacy labels (camera, location, identifiers) to match the permission strings in `app.config.ts`.

### Android

1. Build with `eas build --profile production --platform android`, which produces an AAB.
2. App links: host `/.well-known/assetlinks.json` with the signing certificate SHA-256 from `eas credentials`.
3. Submit with `eas submit --platform android`, then complete the Data safety form.

CI: **Mobile builds (EAS)** workflow (`workflow_dispatch`) with an `EXPO_TOKEN` secret.

## Observability

- Structured JSON errors are logged by API routes, with a `requestId`. Forward the logs to your log platform.
- Sentry: set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`. The SDK is not initialised yet (see SECURITY.md open items).
- Supabase dashboard: the database advisors (security and performance), API logs and Auth logs.

## Production checklist

- [ ] Separate Supabase projects for staging and production; PITR on; restore tested
- [ ] External nightly `pg_dump` and private-bucket replication configured
- [ ] Auth: SMTP, redirect allow-list, CAPTCHA, providers, MFA enforced for owners and admins
- [ ] `root_domain` set; wildcard DNS and TLS working; unknown hosts return 404
- [ ] Stripe live keys with `PAYMENTS_MODE=live`; webhook endpoint and secret set; Connect accounts onboarded; test live payment and refund
- [ ] `release-holds` and `tick` crons running; `CRON_SECRET` rotated; email (Resend), push (Expo) and optional SMS (Twilio) configured
- [ ] Distributed rate limiting (Redis) configured
- [ ] Sentry initialised; alerts on webhook `FAILED` events and 5xx rates
- [ ] Legal: each tenant has published terms and privacy text (`tenant_settings.legal_*`); cookie consent where required
- [ ] Security open items in SECURITY.md resolved or accepted
- [ ] E2E suite green against staging (`pnpm test:e2e` with `ADMIN_URL`/`WEB_URL` pointed at it)
- [ ] `ADMIN_MFA_POLICY` left at the production default (`privileged`)
