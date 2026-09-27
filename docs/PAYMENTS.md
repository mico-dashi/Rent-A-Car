# Payments

## Model

- **The rental charge and the security deposit are separate.** The rental charge is a PaymentIntent with automatic capture for the amount due now. The deposit is authorized close to pickup with manual capture.
- **Providers are behind a port** (`PaymentProvider` in `@rental/payments`). Stripe is the first implementation. Raw card data never reaches our servers: Stripe Payment Element collects it, including Apple Pay and Google Pay where available.
- **Marketplace model**: Stripe Connect. Each tenant has a connected account (`tenant_payment_accounts.provider_account_id`). PaymentIntents are created on the connected account, with an `application_fee_amount` computed by `platformFee()` from the subscription or plan commission terms (`NONE`, `PERCENTAGE`, `FIXED` or `CUSTOM`). SaaS subscription billing is recorded in `tenant_subscriptions`. The recurring billing integration itself is not implemented yet.

## Configuration (test mode)

1. Create a Stripe account and enable Connect.
2. Put the Stripe keys in the web app's server environment:

   | Variable | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | `sk_test_…` |
   | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` |
   | `PAYMENTS_MODE` | `test` |

   The provider refuses to start when the key mode and `PAYMENTS_MODE` disagree.
3. Create a webhook endpoint at `https://<web-host>/api/v1/webhooks/stripe` and put its signing secret in `STRIPE_WEBHOOK_SECRET`. Subscribe to these events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.amount_capturable_updated`
   - `payment_intent.canceled`
   - `refund.updated`
   - `refund.failed`
   - `setup_intent.succeeded`
   - `account.updated` (Connect)
4. For local testing, run `stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe`.
5. Link a tenant: the owner clicks **Payments → Connect Stripe** in the dashboard (also onboarding step 7). That creates an Express connected account and sends the owner through Stripe-hosted onboarding; `account.updated` webhooks keep `charges_enabled`/`payouts_enabled` in sync.

If Stripe is not configured, bookings that need payment are refused with `PAYMENTS_NOT_CONFIGURED`. Nothing is marked paid without a verified webhook.

## Booking payment lifecycle

1. `POST /api/v1/bookings` re-prices the booking on the server and calls `create_booking`. The result is a `PENDING_PAYMENT` booking holding the vehicle for `tenant_settings.hold_minutes`.
2. The server creates a PaymentIntent using the idempotency key `<bookingKey>:rental` and stores a `payments` row with status `REQUIRES_PAYMENT`.
3. The client confirms the payment. 3DS is handled by Stripe.
4. Stripe sends `payment_intent.succeeded` to the webhook. The webhook runs these steps:
   - verify the signature
   - insert `webhook_events` (duplicates are ignored)
   - claim the event
   - mark the payment `SUCCEEDED` and write a ledger row in `payment_transactions`
   - call `record_booking_payment`, which moves the booking to `CONFIRMED` (or `PENDING_APPROVAL`)
5. **Late payment edge case:** if the hold expired and another customer took the car, `record_booking_payment` returns `HOLD_LOST`. The handler then issues an automatic full refund, using a deterministic idempotency key.

## Deposits

`planDeposit()` chooses between two strategies:

| Strategy | When it applies | What happens |
|---|---|---|
| `AUTHORIZE_NOW` | Pickup is near and the whole rental fits inside the authorization window | The deposit is authorized immediately |
| `SAVE_METHOD_AND_AUTHORIZE_LATER` | Anything else | The rental PaymentIntent uses `setup_future_usage=off_session`. The scheduler tick (`authorizeDueDeposits`) creates a manual-capture PaymentIntent at `authorize_after` with the saved card |

At return:
- Staff confirm the proposed charges from `computeReturnCharges()` (mileage, fuel or battery, late return) and any damage decisions.
- `depositCaptureAmount()` captures only the approved total, capped at the authorization. The rest is released.
- Damage captures require `vehicle_damages.status = CUSTOMER_RESPONSIBLE`. That status carries a `decided_by` human, enforced by a database check.

## Refunds

- Every refund creates a `refunds` row with an idempotency key. The trigger `guard_refund_total` locks the payment row and rejects any refund that would exceed the captured amount.
- The provider refund uses the same idempotency key, and the webhook finalizes its status.
- Customer cancellations compute `refundable_minor = paid − refunded − fee` in `transition_booking`. The scheduler tick (`refundCancelledBookings`) issues that refund against the rental payments with a per-payment idempotency key, so a retry never refunds twice. Staff with `payments.refund` can also refund manually from the booking.

## Webhook guarantees

| Guarantee | How |
|---|---|
| Signed | Raw-body signature verification. Forged or tampered payloads get 400 and are never stored. |
| Idempotent | `UNIQUE (provider, event_id)` plus a conditional claim. Handlers also dedupe their ledger rows on `(provider_transaction_id, kind, status)`. |
| Retry-safe | A handler failure marks the event `FAILED` and returns 500, so Stripe retries. A stale `PROCESSING` claim older than 5 minutes can be retried. |
| Logged | Every event is stored with its payload, attempts, status and last error. |
| Mode-safe | Live events hitting a test deployment (and vice versa) are ignored. |
