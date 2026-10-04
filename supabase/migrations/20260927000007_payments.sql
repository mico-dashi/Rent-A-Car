-- =====================================================================
-- 0007 PAYMENTS, DEPOSITS, REFUNDS, INVOICES, WEBHOOKS, IDEMPOTENCY
-- Raw card data never touches this database; only provider references.
-- All writes happen from trusted server code (service role) — clients
-- only get SELECT via RLS.
-- =====================================================================

create table public.tenant_payment_accounts (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  provider text not null default 'stripe',
  provider_account_id text,          -- e.g. Stripe Connect acct_...
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  test_mode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);
select app.install_row_triggers('public.tenant_payment_accounts');

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  provider text not null,
  provider_customer_id text not null,
  provider_payment_method_id text not null,
  brand text,
  last4 char(4) check (last4 ~ '^[0-9]{4}$'),
  exp_month smallint check (exp_month between 1 and 12),
  exp_year smallint check (exp_year between 2000 and 2100),
  wallet text check (wallet in ('apple_pay', 'google_pay')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade,
  unique (provider, provider_payment_method_id)
);
select app.install_row_triggers('public.payment_methods');

-- One logical payment (provider PaymentIntent) for a purpose.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  booking_id uuid,
  customer_id uuid,
  purpose public.payment_intent_kind not null,
  provider text not null,
  provider_payment_id text,          -- pi_...
  amount_minor bigint not null check (amount_minor > 0),
  amount_captured_minor bigint not null default 0 check (amount_captured_minor >= 0),
  amount_refunded_minor bigint not null default 0 check (amount_refunded_minor >= 0),
  application_fee_minor bigint not null default 0 check (application_fee_minor >= 0),
  currency char(3) not null references public.currencies(code),
  status text not null default 'REQUIRES_PAYMENT'
    check (status in ('REQUIRES_PAYMENT', 'PROCESSING', 'AUTHORIZED', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  failure_code text,
  failure_message text,
  idempotency_key text not null,
  is_test boolean not null default true,
  approved_by uuid references auth.users(id), -- required for DAMAGE / LATE_FEE charges
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (provider, provider_payment_id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id),
  check (amount_captured_minor <= amount_minor),
  check (amount_refunded_minor <= amount_captured_minor),
  check (purpose not in ('DAMAGE', 'LATE_FEE') or approved_by is not null)
);
create index payments_booking_idx on public.payments(booking_id);
create index payments_tenant_status_idx on public.payments(tenant_id, status, created_at desc);
select app.install_row_triggers('public.payments');

-- Append-only ledger of provider operations.
create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_id uuid not null,
  kind public.transaction_kind not null,
  status public.transaction_status not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  provider_transaction_id text,     -- ch_..., re_..., etc.
  provider_event_id text,           -- evt_... that produced this row
  raw jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, payment_id) references public.payments(tenant_id, id),
  unique (provider_transaction_id, kind, status)
);
create index payment_transactions_payment_idx on public.payment_transactions(payment_id, created_at);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_id uuid not null,
  booking_id uuid,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  reason text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  provider_refund_id text unique,
  idempotency_key text not null,
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, payment_id) references public.payments(tenant_id, id),
  unique (tenant_id, idempotency_key)
);
select app.install_row_triggers('public.refunds');

-- Over-refund guard: sum of non-failed refunds may never exceed captured amount.
create or replace function app.guard_refund_total() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_captured bigint;
  v_refunded bigint;
begin
  select amount_captured_minor into v_captured from public.payments where id = new.payment_id for update;
  select coalesce(sum(amount_minor), 0) into v_refunded from public.refunds
   where payment_id = new.payment_id and status in ('PENDING', 'SUCCEEDED') and id <> new.id;
  if v_refunded + new.amount_minor > v_captured then
    raise exception 'Refund exceeds captured amount (captured %, refunded %, requested %)',
      v_captured, v_refunded, new.amount_minor using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_refund_total before insert or update of amount_minor, status on public.refunds
  for each row when (new.status in ('PENDING', 'SUCCEEDED'))
  execute function app.guard_refund_total();

create table public.security_deposits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  booking_id uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  status public.deposit_status not null default 'PENDING',
  payment_method_id uuid references public.payment_methods(id),
  payment_id uuid,                 -- the authorization PaymentIntent
  authorize_after timestamptz,     -- scheduled authorization time (close to pickup)
  authorized_at timestamptz,
  authorization_expires_at timestamptz,
  captured_minor bigint not null default 0 check (captured_minor >= 0),
  capture_reason text,
  captured_by uuid references auth.users(id),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id),
  foreign key (tenant_id, payment_id) references public.payments(tenant_id, id),
  check (captured_minor <= amount_minor),
  check (captured_minor = 0 or (capture_reason is not null and captured_by is not null))
);
create index security_deposits_authorize_idx on public.security_deposits(authorize_after)
  where status in ('PENDING', 'METHOD_SAVED');
select app.install_row_triggers('public.security_deposits');

create sequence public.invoice_number_seq;
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  booking_id uuid,
  customer_id uuid,
  number text not null,
  kind text not null default 'INVOICE' check (kind in ('INVOICE', 'RECEIPT', 'CREDIT_NOTE')),
  currency char(3) not null,
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  tax_minor bigint not null check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  lines jsonb not null,             -- immutable snapshot
  pdf_path text,                    -- private bucket documents
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, number),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id),
  check (total_minor = subtotal_minor + tax_minor)
);

-- Every inbound provider webhook, stored before processing. The unique
-- (provider, event_id) makes processing idempotent across retries.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  tenant_id uuid references public.tenants(id) on delete set null,
  payload jsonb not null,
  signature_verified boolean not null,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED')),
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id),
  check (signature_verified) -- unverified payloads are rejected before insert
);
create index webhook_events_status_idx on public.webhook_events(status, received_at) where status in ('RECEIVED', 'FAILED');

-- Generic idempotency for booking/financial commands issued by clients.
create table public.idempotency_keys (
  key text not null,
  scope text not null,              -- e.g. 'booking.create', 'refund.create'
  user_id uuid,
  tenant_id uuid references public.tenants(id) on delete cascade,
  request_hash text not null,
  response jsonb,
  status_code integer,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key (scope, key)
);
create index idempotency_keys_expiry_idx on public.idempotency_keys(expires_at);

-- SaaS: commission ledger per booking payment (never hard-coded; derived from plan/subscription).
create table public.platform_fees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_id uuid not null,
  kind public.commission_kind not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, payment_id) references public.payments(tenant_id, id),
  unique (payment_id)
);
