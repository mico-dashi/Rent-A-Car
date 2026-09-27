# API

## HTTP routes (`apps/web`)

All routes resolve the tenant from the `Host` header. Errors follow the shape `{ "error": { "code": "<BUSINESS_CODE>", "details"?: … } }`, where the codes come from `packages/types/src/errors.ts`. Internal errors never include stack traces.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/quotes` | none (rate-limited, 60/min/IP) | Body: `quoteRequestSchema`. Returns the itemised price lines, total, deposit, due now and due later. Prices come only from the database. |
| POST | `/api/v1/bookings` | user JWT (cookie or `Authorization: Bearer`) | Body: `createBookingRequestSchema` (includes `idempotencyKey`). Re-prices, creates the booking hold and the PaymentIntent. Returns `{id, reference, status, holdExpiresAt, payment: {clientSecret, stripeAccount} \| null}`. The same key returns the same booking. |
| POST | `/api/v1/webhooks/stripe` | Stripe signature | See [PAYMENTS.md](PAYMENTS.md). |
| POST | `/api/v1/cron/release-holds` | `Bearer CRON_SECRET` | Releases expired unpaid holds. |
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

## Tables over PostgREST

Clients read tables directly under RLS, for example `catalog_vehicles`, `branches`, `extras` and the caller's own `bookings`. Writes to bookings, payments and other financial tables are not granted to API roles.
