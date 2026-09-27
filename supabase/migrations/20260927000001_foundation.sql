-- =====================================================================
-- 0001 FOUNDATION: extensions, private schema, enums, shared triggers
-- =====================================================================
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;

-- Private schema for security-definer helpers. Never exposed via PostgREST.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.tenant_status as enum ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');
create type public.membership_status as enum ('INVITED', 'ACTIVE', 'SUSPENDED');
create type public.role_key as enum ('TENANT_OWNER', 'TENANT_ADMIN', 'MANAGER', 'EMPLOYEE', 'DRIVER');
create type public.subscription_status as enum ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'LIFETIME');
create type public.billing_interval as enum ('MONTHLY', 'ANNUAL', 'LIFETIME');
create type public.domain_status as enum ('PENDING_VERIFICATION', 'VERIFIED', 'FAILED', 'REMOVED');

create type public.vehicle_status as enum
  ('AVAILABLE', 'RESERVED', 'RENTED', 'MAINTENANCE', 'CLEANING', 'DAMAGED', 'INACTIVE', 'SOLD');
create type public.vehicle_category as enum
  ('ECONOMY', 'COMPACT', 'SEDAN', 'SUV', 'LUXURY', 'SPORTS', 'CONVERTIBLE', 'ELECTRIC', 'VAN', 'FOUR_BY_FOUR');
create type public.transmission as enum ('MANUAL', 'AUTOMATIC');
create type public.fuel_type as enum ('PETROL', 'DIESEL', 'HYBRID', 'PLUGIN_HYBRID', 'ELECTRIC', 'LPG');
create type public.drivetrain as enum ('FWD', 'RWD', 'AWD', 'FOUR_WD');
create type public.block_kind as enum ('BOOKING', 'MAINTENANCE', 'CLEANING', 'MANUAL', 'TRANSFER');

create type public.booking_status as enum (
  'DRAFT', 'QUOTE', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'CHECK_IN_PENDING',
  'READY_FOR_PICKUP', 'ACTIVE', 'RETURN_DUE', 'RETURNED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'DISPUTED'
);
create type public.booking_mode as enum ('EXACT_VEHICLE', 'VEHICLE_CLASS');
create type public.pickup_type as enum ('BRANCH', 'AIRPORT', 'HOTEL', 'CUSTOM_ADDRESS');
create type public.payment_status as enum
  ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED');

create type public.price_line_kind as enum (
  'BASE', 'WEEKEND_SURCHARGE', 'SEASONAL', 'AIRPORT_SURCHARGE', 'DELIVERY', 'ONE_WAY_FEE',
  'YOUNG_DRIVER_FEE', 'ADDITIONAL_DRIVER', 'INSURANCE', 'EXTRA', 'MILEAGE', 'LATE_RETURN',
  'DYNAMIC_ADJUSTMENT', 'DISCOUNT', 'COUPON', 'TAX', 'FUEL', 'DAMAGE', 'OTHER'
);
create type public.extra_billing as enum ('PER_DAY', 'PER_BOOKING', 'PER_UNIT', 'FREE');

create type public.payment_intent_kind as enum ('RENTAL', 'DEPOSIT', 'LATE_FEE', 'DAMAGE', 'OTHER');
create type public.transaction_kind as enum ('AUTHORIZE', 'CAPTURE', 'CHARGE', 'VOID', 'REFUND', 'RELEASE');
create type public.transaction_status as enum ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
create type public.deposit_status as enum
  ('NOT_REQUIRED', 'PENDING', 'METHOD_SAVED', 'AUTHORIZED', 'PARTIALLY_CAPTURED', 'CAPTURED', 'RELEASED', 'FAILED');

create type public.inspection_kind as enum ('PICKUP', 'RETURN', 'ROUTINE');
create type public.damage_status as enum (
  'REPORTED', 'REVIEWING', 'CUSTOMER_RESPONSIBLE', 'COMPANY_RESPONSIBLE', 'INSURANCE',
  'REPAIR_SCHEDULED', 'REPAIRED', 'CLOSED'
);
create type public.maintenance_type as enum ('OIL', 'TIRES', 'BRAKES', 'REPAIR', 'INSPECTION', 'CLEANING', 'CUSTOM');
create type public.expense_category as enum
  ('MAINTENANCE', 'REPAIR', 'INSURANCE', 'REGISTRATION', 'CLEANING', 'FUEL', 'PARKING', 'TOLL', 'OTHER');
create type public.document_kind as enum
  ('REGISTRATION', 'INSURANCE', 'INSPECTION', 'OWNERSHIP', 'LEASE', 'SERVICE_RECORD', 'OTHER');
create type public.customer_document_kind as enum
  ('LICENSE_FRONT', 'LICENSE_BACK', 'PASSPORT', 'NATIONAL_ID', 'PROOF_OF_ADDRESS', 'OTHER');
create type public.verification_status as enum ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');
create type public.notification_channel as enum ('IN_APP', 'PUSH', 'EMAIL', 'SMS');
create type public.commission_kind as enum ('NONE', 'PERCENTAGE', 'FIXED', 'CUSTOM');

-- ---------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Prevents a row's tenant_id from ever being changed (moving data across tenants).
create or replace function app.freeze_tenant_id() returns trigger
language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

-- Attach updated_at + tenant-immutability triggers to a table in one call.
create or replace function app.install_row_triggers(tbl regclass, has_tenant boolean default true)
returns void language plpgsql as $$
begin
  execute format('create trigger set_updated_at before update on %s for each row execute function app.set_updated_at()', tbl);
  if has_tenant then
    execute format('create trigger freeze_tenant_id before update on %s for each row execute function app.freeze_tenant_id()', tbl);
  end if;
end $$;
