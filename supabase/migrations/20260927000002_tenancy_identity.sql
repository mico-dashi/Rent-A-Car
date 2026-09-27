-- =====================================================================
-- 0002 PLATFORM, TENANCY, IDENTITY, RBAC
-- =====================================================================

-- ---------------- Platform reference data ----------------
create table public.currencies (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  minor_units smallint not null default 2 check (minor_units between 0 and 4),
  is_enabled boolean not null default true
);

create table public.languages (
  code text primary key check (code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name text not null,
  is_enabled boolean not null default true
);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  monthly_price_minor bigint not null check (monthly_price_minor >= 0),
  annual_price_minor bigint not null check (annual_price_minor >= 0),
  currency char(3) not null references public.currencies(code),
  -- Limits: null = unlimited
  max_vehicles integer check (max_vehicles is null or max_vehicles >= 0),
  max_branches integer check (max_branches is null or max_branches >= 0),
  max_staff integer check (max_staff is null or max_staff >= 0),
  features jsonb not null default '{}'::jsonb,   -- {"custom_domain":true,"advanced_analytics":false,...}
  commission_kind public.commission_kind not null default 'NONE',
  commission_bps integer not null default 0 check (commission_bps between 0 and 10000),
  commission_fixed_minor bigint not null default 0 check (commission_fixed_minor >= 0),
  trial_days integer not null default 14 check (trial_days between 0 and 365),
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select app.install_row_triggers('public.subscription_plans', false);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code citext not null unique,
  percent_off_bps integer check (percent_off_bps between 1 and 10000),
  amount_off_minor bigint check (amount_off_minor > 0),
  currency char(3) references public.currencies(code),
  duration_months integer check (duration_months > 0),
  max_redemptions integer check (max_redemptions > 0),
  redemptions integer not null default 0 check (redemptions >= 0),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((percent_off_bps is null) <> (amount_off_minor is null)),
  check (amount_off_minor is null or currency is not null)
);
select app.install_row_triggers('public.coupons', false);

create table public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'ALL_TENANTS' check (audience in ('ALL_TENANTS', 'OWNERS', 'ALL_USERS')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
select app.install_row_triggers('public.platform_announcements', false);

-- ---------------- Identity ----------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  avatar_path text,
  preferred_language text references public.languages(code),
  preferred_currency char(3) references public.currencies(code),
  mfa_required boolean not null default false,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select app.install_row_triggers('public.profiles', false);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------------- Tenancy ----------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  legal_name text not null,
  display_name text not null,
  status public.tenant_status not null default 'PENDING_APPROVAL',
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  base_currency char(3) not null references public.currencies(code),
  default_language text not null references public.languages(code),
  tenant_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  owner_user_id uuid references auth.users(id),
  suspended_reason text,
  suspended_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select app.install_row_triggers('public.tenants', false);

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  timezone text not null default 'UTC',
  reservation_buffer_minutes integer not null default 60 check (reservation_buffer_minutes between 0 and 2880),
  booking_mode public.booking_mode not null default 'EXACT_VEHICLE',
  requires_manual_approval boolean not null default false,
  min_rental_minutes integer not null default 1440 check (min_rental_minutes > 0),
  max_rental_days integer not null default 90 check (max_rental_days > 0),
  min_lead_time_minutes integer not null default 120 check (min_lead_time_minutes >= 0),
  hold_minutes integer not null default 15 check (hold_minutes between 5 and 120),
  default_min_driver_age smallint not null default 21 check (default_min_driver_age between 16 and 99),
  young_driver_age_below smallint not null default 25 check (young_driver_age_below between 16 and 99),
  -- Cancellation: free until N hours before pickup, then fee bps of rental total
  free_cancellation_hours integer not null default 48 check (free_cancellation_hours >= 0),
  late_cancellation_fee_bps integer not null default 10000 check (late_cancellation_fee_bps between 0 and 10000),
  -- Payment policy
  payment_timing text not null default 'FULL_AT_BOOKING'
    check (payment_timing in ('FULL_AT_BOOKING', 'PARTIAL_AT_BOOKING', 'PAY_AT_PICKUP')),
  partial_payment_bps integer not null default 3000 check (partial_payment_bps between 0 and 10000),
  deposit_authorize_hours_before integer not null default 24 check (deposit_authorize_hours_before between 0 and 168),
  late_return_grace_minutes integer not null default 59 check (late_return_grace_minutes >= 0),
  -- Fuel
  fuel_policy text not null default 'FULL_TO_FULL' check (fuel_policy in ('FULL_TO_FULL', 'SAME_TO_SAME', 'PREPAID')),
  fuel_charge_per_eighth_minor bigint not null default 0 check (fuel_charge_per_eighth_minor >= 0),
  dynamic_pricing_enabled boolean not null default false,
  price_floor_bps integer not null default 5000 check (price_floor_bps between 0 and 10000),
  price_ceiling_bps integer not null default 20000 check (price_ceiling_bps >= 10000),
  onboarding_step smallint not null default 1 check (onboarding_step between 1 and 12),
  onboarding_data jsonb not null default '{}'::jsonb,
  onboarding_completed_at timestamptz,
  legal_terms_md text,
  legal_privacy_md text,
  legal_policy_version text not null default '1',
  data_retention_days integer not null default 2555 check (data_retention_days >= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select app.install_row_triggers('public.tenant_settings');

create table public.tenant_branding (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  primary_color text not null default '#EC0618' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#212325' check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  background_color text not null default '#010101' check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_heading text not null default 'Inter',
  font_body text not null default 'Inter',
  logo_path text,
  logo_dark_path text,
  app_icon_path text,
  splash_path text,
  hero_image_path text,
  headline text,
  subheadline text,
  about_md text,
  contact_email text,
  contact_phone text,
  contact_address text,
  social_links jsonb not null default '{}'::jsonb,
  faq jsonb not null default '[]'::jsonb,
  email_from_name text,
  email_footer text,
  hide_platform_branding boolean not null default false,
  default_theme text not null default 'dark' check (default_theme in ('dark', 'light', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select app.install_row_triggers('public.tenant_branding');

create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hostname citext not null unique check (hostname ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  is_platform_subdomain boolean not null default false,
  is_primary boolean not null default false,
  status public.domain_status not null default 'PENDING_VERIFICATION',
  verification_token text not null default encode(gen_random_bytes(16), 'hex'),
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tenant_domains_one_primary on public.tenant_domains(tenant_id) where is_primary;
create index tenant_domains_tenant_idx on public.tenant_domains(tenant_id);
select app.install_row_triggers('public.tenant_domains');

create table public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status public.subscription_status not null default 'TRIALING',
  interval public.billing_interval not null default 'MONTHLY',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  coupon_id uuid references public.coupons(id),
  provider text,
  provider_subscription_id text,
  -- Per-tenant commission override (enterprise agreements); null = use plan
  commission_kind public.commission_kind,
  commission_bps integer check (commission_bps between 0 and 10000),
  commission_fixed_minor bigint check (commission_fixed_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tenant_subscriptions_one_live on public.tenant_subscriptions(tenant_id)
  where status in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'LIFETIME');
create unique index tenant_subscriptions_provider_id on public.tenant_subscriptions(provider, provider_subscription_id)
  where provider_subscription_id is not null;
select app.install_row_triggers('public.tenant_subscriptions');

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z0-9_.]+$'),
  tenant_id uuid references public.tenants(id) on delete cascade, -- null = platform default
  enabled boolean not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index feature_flags_global on public.feature_flags(key) where tenant_id is null;
create unique index feature_flags_tenant on public.feature_flags(key, tenant_id) where tenant_id is not null;
create trigger set_updated_at before update on public.feature_flags for each row execute function app.set_updated_at();

-- ---------------- RBAC ----------------
create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);

create table public.roles (
  key public.role_key primary key,
  name text not null,
  rank smallint not null unique  -- lower = more powerful; used to prevent privilege escalation
);

create table public.role_permissions (
  role public.role_key not null references public.roles(key) on delete cascade,
  permission text not null references public.permissions(key) on delete cascade,
  primary key (role, permission)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email citext,
  role public.role_key not null,
  status public.membership_status not null default 'INVITED',
  branch_ids uuid[] not null default '{}',  -- empty = all branches
  invite_token_hash text,
  invite_expires_at timestamptz,
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or invited_email is not null)
);
create unique index memberships_tenant_user on public.memberships(tenant_id, user_id) where user_id is not null;
create unique index memberships_tenant_invite on public.memberships(tenant_id, invited_email) where user_id is null;
create index memberships_user_idx on public.memberships(user_id);
select app.install_row_triggers('public.memberships');

-- Per-membership grants/revocations on top of the role's defaults.
create table public.membership_permission_overrides (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  permission text not null references public.permissions(key) on delete cascade,
  granted boolean not null,
  primary key (membership_id, permission)
);
