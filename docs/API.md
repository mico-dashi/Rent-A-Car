# API

## HTTP routes (`apps/web`)

All routes resolve the tenant from the `Host` header. Errors follow the shape `{ "error": { "code": "<BUSINESS_CODE>", "details"?: … } }`, where the codes come from `packages/types/src/errors.ts`. Internal errors never include stack traces.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/quotes` | none (rate-limited, 60/min/IP) | Body: `quoteRequestSchema`. Returns the itemised price lines, total, deposit, due now and due later. Prices come only from the database. |
| POST | `/api/v1/bookings` | user JWT (cookie or `Authorization: Bearer`) | Body: `createBookingRequestSchema` (includes `idempotencyKey`). Re-prices, creates the booking hold and the PaymentIntent. Returns `{id, reference, status, holdExpiresAt, payment: {clientSecret, stripeAccount} \| null}`. The same key returns the same booking. |
| POST | `/api/v1/webhooks/stripe` | Stripe signature | See [PAYMENTS.md](PAYMENTS.md). |
| GET/POST | `/api/v1/cron/release-holds` | `Bearer CRON_SECRET` | Releases expired unpaid holds (every minute). |
| GET/POST | `/api/v1/cron/tick` | `Bearer CRON_SECRET` | Scheduler tick (every 5 min): holds, housekeeping and reminders, deposit authorisations, cancellation refunds, notification delivery, domain verification. `200` with per-job results, `207` if any job failed. |
| GET | `/account/documents/{agreement\|invoice}/{id}` | customer session | Redirects to a 60-second signed URL for the customer's own agreement or invoice PDF (ownership checked through RLS). |
| GET | `/account/export` | customer session | GDPR export of everything the account holds, as a JSON download. |
| POST | `/api/v1/identity/session` | user JWT (cookie or `Authorization: Bearer`) | Starts Stripe Identity verification for the caller's customer record in this tenant. Returns `{ alreadyVerified, url? }`. Rate-limited; `PAYMENTS_NOT_CONFIGURED` without Stripe. |
| GET | `/auth/callback` | — | OAuth, magic-link and confirmation code exchange. |

## Database RPCs (Supabase `rpc()`)

| RPC | Callers | Purpose |
|---|---|---|
| `resolve_tenant(p_hostname, p_slug, p_code)` | anon, authenticated | Public storefront config of an ACTIVE tenant |
| `search_available_vehicles(p_tenant, p_starts_at, p_ends_at, p_pickup_branch, p_category, p_limit, p_offset)` | anon, authenticated | Vehicles genuinely free, including the buffer and class capacity |
| `is_vehicle_available(p_vehicle, p_starts_at, p_ends_at)` | anon, authenticated | Single-vehicle check |
| `tenant_legal_documents(p_tenant)` | anon, authenticated | Published terms and privacy text |
| `create_tenant(...)` | authenticated | Onboarding step 1 |
| `accept_invitation(p_token)` | authenticated | Staff invite acceptance (hash-matched, email-bound, expiring) |
| `transition_booking(p_booking, p_to, p_reason, p_expected_version)` | authenticated | Role-aware lifecycle changes with pickup and return gates, cancellation fee, optimistic concurrency |
| `assign_booking_vehicle(p_booking, p_vehicle, p_reason)` | staff | Class assignment and substitution (same class, higher rank or equivalence group) |
| `my_memberships()` / `am_platform_admin()` | authenticated | Session permissions for UI affordances |
| `create_booking(p jsonb)` | **service role only** | Atomic booking creation (see ARCHITECTURE §F) |
| `record_booking_payment(...)` | **service role only** | Called by the webhook |
| `release_expired_holds(p_vehicle)` | **service role only** | Hold expiry |
| `modify_booking(p jsonb)` | **service role only** | Date/branch change with re-pricing and occupancy move |
| `run_housekeeping()` | **service role only** | Overdue returns, no-shows, maintenance due, expiring documents, reminders |
| `record_refund(...)` / `next_document_number(p_tenant, p_kind)` | **service role only** | Refund settlement; gap-free per-tenant invoice numbers |
| `invite_staff(...)` / `set_membership_status(...)` | `staff.manage` | Team invitations and suspension (plan limits enforced) |
| `add_post_rental_charges(p_booking, p_lines)` | `payments.charge` | Staff-confirmed return charges |
| `tenant_dashboard(p_tenant, p_from, p_to)` | `reports.read` | KPIs and series for the dashboard and reports |
| `tenant_features(p_tenant)` | members | Effective feature flags (plan + overrides) |
| `vehicle_by_qr(p_token)` | `vehicles.read` | Resolve a fleet QR code within the caller's tenant |
| `platform_overview()` / `admin_set_tenant_status(...)` / `admin_anonymize_user(...)` | platform admin | Platform console |
| `export_my_data()` / `request_account_deletion()` | authenticated | Privacy self-service |
| `apply_data_retention(p_limit)` | **service role only** | Retention enforcement; returns the storage files to delete |
| `nearby_tenants(p_lat, p_lng, p_radius_km, p_limit)` | anon, authenticated | Universal app discovery: active tenants with discovery enabled, nearest branch and distance |

## Tables over PostgREST

Clients read tables directly under RLS, for example `catalog_vehicles`, `branches`, `extras` and the caller's own `bookings`. Writes to bookings, payments and other financial tables are not granted to API roles.
