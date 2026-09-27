-- =====================================================================
-- 0005 CUSTOMERS (CRM) & PRICING CONFIGURATION
-- A person may be a customer of many tenants; each tenant gets its own
-- customer record (tenant-scoped CRM data, documents and restrictions).
-- =====================================================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, -- null for walk-in customers
  first_name text not null,
  last_name text not null,
  email citext not null,
  phone text,
  date_of_birth date check (date_of_birth is null or date_of_birth > date '1900-01-01'),
  address_line1 text,
  address_line2 text,
  city text,
  postal_code text,
  country_code char(2) check (country_code ~ '^[A-Z]{2}$'),
  nationality char(2) check (nationality ~ '^[A-Z]{2}$'),
  preferred_language text references public.languages(code),
  preferred_currency char(3) references public.currencies(code),
  emergency_contact_name text,
  emergency_contact_phone text,
  identity_status public.verification_status not null default 'UNVERIFIED',
  identity_provider text,             -- stripe_identity | persona | veriff | manual
  identity_provider_ref text,
  identity_verified_at timestamptz,
  is_restricted boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index customers_tenant_user on public.customers(tenant_id, user_id) where user_id is not null;
create index customers_tenant_email on public.customers(tenant_id, email);
select app.install_row_triggers('public.customers');

create table public.driver_licenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  license_number text not null,
  issuing_country char(2) not null check (issuing_country ~ '^[A-Z]{2}$'),
  issued_on date,
  expires_on date not null,
  categories text[] not null default '{B}',
  front_image_path text,              -- private bucket customer-documents
  back_image_path text,
  verification_status public.verification_status not null default 'UNVERIFIED',
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade,
  check (issued_on is null or expires_on > issued_on)
);
create index driver_licenses_customer_idx on public.driver_licenses(customer_id);
select app.install_row_triggers('public.driver_licenses');

create table public.customer_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  kind public.customer_document_kind not null,
  storage_path text not null,
  verification_status public.verification_status not null default 'PENDING',
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade
);
create index customer_documents_customer_idx on public.customer_documents(customer_id);
select app.install_row_triggers('public.customer_documents');

-- Restriction / blacklist history. Rows are append-only; lifting a
-- restriction is a new row with action = 'LIFT'.
create table public.customer_restrictions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  action text not null check (action in ('RESTRICT', 'BLACKLIST', 'LIFT')),
  reason text not null check (length(trim(reason)) >= 3),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade
);
create index customer_restrictions_customer_idx on public.customer_restrictions(customer_id, created_at desc);

create or replace function app.apply_customer_restriction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.customers set is_restricted = (new.action <> 'LIFT') where id = new.customer_id;
  return new;
end $$;
create trigger apply_customer_restriction after insert on public.customer_restrictions
  for each row execute function app.apply_customer_restriction();

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  body text not null,
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade
);

create table public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, vehicle_id),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id) on delete cascade
);

-- ---------------- Pricing configuration ----------------
create table public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  rate_bps integer not null check (rate_bps between 0 and 10000),  -- 2000 = 20%
  is_inclusive boolean not null default false,
  jurisdiction_label text,
  applies_to text[] not null default '{RENTAL,EXTRAS,FEES}',
  effective_from date not null default current_date,
  effective_to date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index tax_rules_tenant_idx on public.tax_rules(tenant_id, effective_from);
select app.install_row_triggers('public.tax_rules');

create table public.seasonal_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  adjustment_bps integer not null check (adjustment_bps between -9000 and 50000), -- +2500 = +25%
  category public.vehicle_category,     -- null = all categories
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
select app.install_row_triggers('public.seasonal_rates');

-- Generic rule-based adjustments (weekend, airport, lead-time, utilization, duration...).
-- `condition` is validated by the domain package's Zod schema before insert.
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  kind text not null check (kind in (
    'WEEKEND_SURCHARGE', 'AIRPORT_SURCHARGE', 'DURATION_DISCOUNT', 'LEAD_TIME', 'UTILIZATION',
    'YOUNG_DRIVER_FEE', 'ADDITIONAL_DRIVER_FEE', 'DELIVERY_FLAT', 'DELIVERY_PER_KM', 'LATE_RETURN')),
  is_dynamic boolean not null default false,  -- dynamic rules only apply when tenant enables dynamic pricing
  condition jsonb not null default '{}'::jsonb,
  adjustment_bps integer check (adjustment_bps between -9000 and 50000),
  amount_minor bigint check (amount_minor >= 0),
  per text not null default 'BOOKING' check (per in ('BOOKING', 'DAY', 'KM', 'HOUR')),
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((adjustment_bps is not null) or (amount_minor is not null))
);
create index pricing_rules_tenant_idx on public.pricing_rules(tenant_id) where is_active;
select app.install_row_triggers('public.pricing_rules');

create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code citext not null,
  percent_off_bps integer check (percent_off_bps between 1 and 10000),
  amount_off_minor bigint check (amount_off_minor > 0),
  min_rental_days integer check (min_rental_days > 0),
  valid_from timestamptz,
  valid_until timestamptz,
  max_redemptions integer check (max_redemptions > 0),
  redemptions integer not null default 0 check (redemptions >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  check ((percent_off_bps is null) <> (amount_off_minor is null)),
  check (max_redemptions is null or redemptions <= max_redemptions)
);
select app.install_row_triggers('public.discount_codes');

create table public.extras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  kind text not null default 'EXTRA' check (kind in ('EXTRA', 'INSURANCE')),
  billing public.extra_billing not null,
  price_minor bigint not null check (price_minor >= 0),
  max_price_minor bigint check (max_price_minor >= 0),   -- cap for per-day extras
  max_quantity smallint not null default 1 check (max_quantity between 1 and 20),
  deposit_reduction_bps integer not null default 0 check (deposit_reduction_bps between 0 and 10000),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id),
  check (billing <> 'FREE' or price_minor = 0)
);
select app.install_row_triggers('public.extras');
