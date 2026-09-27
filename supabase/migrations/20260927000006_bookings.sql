-- =====================================================================
-- 0006 BOOKINGS
-- Bookings are mutated only through SECURITY DEFINER RPCs
-- (see 0010_booking_engine.sql); authenticated users get no direct
-- UPDATE/DELETE policy on this table.
-- =====================================================================

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  reference text not null default ('BK-' || upper(encode(gen_random_bytes(4), 'hex'))),
  customer_id uuid not null,
  mode public.booking_mode not null default 'EXACT_VEHICLE',
  vehicle_id uuid,                -- currently assigned vehicle (null for unassigned class bookings)
  vehicle_class_id uuid,
  pickup_branch_id uuid not null,
  return_branch_id uuid not null,
  pickup_type public.pickup_type not null default 'BRANCH',
  delivery_address text,
  delivery_latitude numeric(9,6),
  delivery_longitude numeric(9,6),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.booking_status not null default 'DRAFT',
  version integer not null default 1,
  currency char(3) not null references public.currencies(code),
  -- Immutable price snapshot (all integer minor units)
  rental_minor bigint not null default 0 check (rental_minor >= 0),
  extras_minor bigint not null default 0 check (extras_minor >= 0),
  fees_minor bigint not null default 0 check (fees_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  deposit_minor bigint not null default 0 check (deposit_minor >= 0),
  due_now_minor bigint not null default 0 check (due_now_minor >= 0),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  amount_refunded_minor bigint not null default 0 check (amount_refunded_minor >= 0),
  payment_status public.payment_status not null default 'UNPAID',
  pricing_snapshot jsonb not null default '{}'::jsonb,  -- full engine output incl. rule ids + versions
  discount_code_id uuid references public.discount_codes(id) on delete set null,
  included_km integer check (included_km >= 0),
  driver_age smallint check (driver_age between 16 and 120),
  additional_drivers smallint not null default 0 check (additional_drivers between 0 and 5),
  customer_notes text,
  idempotency_key text,
  quote_expires_at timestamptz,
  confirmed_at timestamptz,
  picked_up_at timestamptz,
  returned_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  cancellation_fee_minor bigint check (cancellation_fee_minor >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, reference),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id),
  foreign key (tenant_id, vehicle_class_id) references public.vehicle_classes(tenant_id, id),
  foreign key (tenant_id, pickup_branch_id) references public.branches(tenant_id, id),
  foreign key (tenant_id, return_branch_id) references public.branches(tenant_id, id),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '366 days'),
  check (mode <> 'EXACT_VEHICLE' or vehicle_id is not null),
  check (mode <> 'VEHICLE_CLASS' or vehicle_class_id is not null),
  check (amount_refunded_minor <= amount_paid_minor),
  check (discount_minor <= rental_minor + extras_minor + fees_minor),
  check (due_now_minor <= total_minor),
  check (pickup_type = 'BRANCH' or pickup_type = 'AIRPORT' or delivery_address is not null)
);
create index bookings_tenant_status_idx on public.bookings(tenant_id, status);
create index bookings_tenant_starts_idx on public.bookings(tenant_id, starts_at);
create index bookings_tenant_ends_idx on public.bookings(tenant_id, ends_at);
create index bookings_customer_idx on public.bookings(customer_id, starts_at desc);
create index bookings_vehicle_idx on public.bookings(vehicle_id, starts_at);
create index bookings_class_unassigned_idx on public.bookings(vehicle_class_id, starts_at)
  where vehicle_id is null and status not in ('CANCELLED', 'NO_SHOW', 'COMPLETED', 'RETURNED');
select app.install_row_triggers('public.bookings');

alter table public.vehicle_availability_blocks
  add constraint vehicle_blocks_booking_fk foreign key (tenant_id, booking_id)
  references public.bookings(tenant_id, id) on delete cascade;

create table public.booking_status_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null,
  from_status public.booking_status,
  to_status public.booking_status not null,
  reason text,
  actor_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index booking_status_history_booking_idx on public.booking_status_history(booking_id, created_at);

create table public.booking_vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null,
  vehicle_id uuid not null,
  block_id uuid not null references public.vehicle_availability_blocks(id),
  reason text not null default 'INITIAL' check (reason in ('INITIAL', 'CLASS_ASSIGNMENT', 'SUBSTITUTION', 'UPGRADE')),
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id)
);
create unique index booking_assignments_one_live on public.booking_vehicle_assignments(booking_id)
  where unassigned_at is null;

create table public.booking_extras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null,
  extra_id uuid not null,
  name_snapshot text not null,
  billing public.extra_billing not null,
  quantity smallint not null default 1 check (quantity between 1 and 20),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  foreign key (tenant_id, extra_id) references public.extras(tenant_id, id),
  unique (booking_id, extra_id)
);

-- Itemised price breakdown. Signed amounts: discounts are negative.
create table public.booking_price_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null,
  kind public.price_line_kind not null,
  label text not null,
  label_params jsonb not null default '{}'::jsonb,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_amount_minor bigint not null,
  amount_minor bigint not null,
  is_taxable boolean not null default true,
  source_rule_id uuid,
  is_post_rental boolean not null default false, -- mileage/fuel/late/damage lines added after return
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  check ((kind in ('DISCOUNT', 'COUPON')) = (amount_minor <= 0) or amount_minor = 0)
);
create index booking_price_lines_booking_idx on public.booking_price_lines(booking_id, sort_order);

create table public.booking_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null,
  body text not null check (length(body) between 1 and 5000),
  is_internal boolean not null default true,
  author_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- State machine (mirrored in packages/domain/src/booking/state-machine.ts;
-- a parity test asserts both tables are identical).
-- ---------------------------------------------------------------------
create table public.booking_status_transitions (
  from_status public.booking_status not null,
  to_status public.booking_status not null,
  primary key (from_status, to_status)
);
insert into public.booking_status_transitions (from_status, to_status) values
  ('DRAFT', 'QUOTE'), ('DRAFT', 'PENDING_PAYMENT'), ('DRAFT', 'PENDING_APPROVAL'), ('DRAFT', 'CONFIRMED'), ('DRAFT', 'CANCELLED'),
  ('QUOTE', 'PENDING_PAYMENT'), ('QUOTE', 'PENDING_APPROVAL'), ('QUOTE', 'CONFIRMED'), ('QUOTE', 'CANCELLED'),
  ('PENDING_PAYMENT', 'PENDING_APPROVAL'), ('PENDING_PAYMENT', 'CONFIRMED'), ('PENDING_PAYMENT', 'CANCELLED'),
  ('PENDING_APPROVAL', 'CONFIRMED'), ('PENDING_APPROVAL', 'CANCELLED'),
  ('CONFIRMED', 'CHECK_IN_PENDING'), ('CONFIRMED', 'READY_FOR_PICKUP'), ('CONFIRMED', 'CANCELLED'), ('CONFIRMED', 'NO_SHOW'),
  ('CHECK_IN_PENDING', 'READY_FOR_PICKUP'), ('CHECK_IN_PENDING', 'CANCELLED'), ('CHECK_IN_PENDING', 'NO_SHOW'),
  ('READY_FOR_PICKUP', 'ACTIVE'), ('READY_FOR_PICKUP', 'CANCELLED'), ('READY_FOR_PICKUP', 'NO_SHOW'),
  ('ACTIVE', 'RETURN_DUE'), ('ACTIVE', 'RETURNED'), ('ACTIVE', 'DISPUTED'),
  ('RETURN_DUE', 'RETURNED'), ('RETURN_DUE', 'DISPUTED'),
  ('RETURNED', 'COMPLETED'), ('RETURNED', 'DISPUTED'),
  ('COMPLETED', 'DISPUTED'),
  ('NO_SHOW', 'DISPUTED'),
  ('DISPUTED', 'COMPLETED'), ('DISPUTED', 'CANCELLED');

create or replace function app.enforce_booking_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;

    if new.status is distinct from old.status
       and not (old.status = 'CANCELLED' and new.status = 'PENDING_PAYMENT'
                and coalesce(current_setting('app.allow_reinstate', true), '') = 'on') then
      if not exists (select 1 from public.booking_status_transitions t
                     where t.from_status = old.status and t.to_status = new.status) then
        raise exception 'Invalid booking transition % -> %', old.status, new.status using errcode = 'P0001';
      end if;
    end if;

    -- Price snapshot is frozen once a booking leaves the quoting phase,
    -- unless a trusted engine function explicitly re-prices.
    if old.status not in ('DRAFT', 'QUOTE', 'PENDING_PAYMENT')
       and coalesce(current_setting('app.allow_reprice', true), '') <> 'on'
       and (new.rental_minor, new.extras_minor, new.fees_minor, new.discount_minor, new.tax_minor,
            new.total_minor, new.deposit_minor, new.pricing_snapshot, new.currency)
           is distinct from
           (old.rental_minor, old.extras_minor, old.fees_minor, old.discount_minor, old.tax_minor,
            old.total_minor, old.deposit_minor, old.pricing_snapshot, old.currency) then
      raise exception 'Booking price snapshot is immutable after confirmation' using errcode = 'P0001';
    end if;

    if new.customer_id <> old.customer_id then
      raise exception 'Booking customer is immutable' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger enforce_booking_rules before update on public.bookings
  for each row execute function app.enforce_booking_rules();

-- Side effects of status changes: history, occupancy release, vehicle status.
create or replace function app.after_booking_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_buffer integer;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.booking_status_history (tenant_id, booking_id, from_status, to_status, reason, actor_id)
    values (new.tenant_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
            nullif(current_setting('app.transition_reason', true), ''), auth.uid());
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status in ('CANCELLED', 'NO_SHOW') then
      update public.vehicle_availability_blocks set released_at = now()
       where booking_id = new.id and released_at is null;
    elsif new.status = 'CONFIRMED' then
      update public.vehicle_availability_blocks set hold_expires_at = null
       where booking_id = new.id and released_at is null;
    elsif new.status = 'ACTIVE' and new.vehicle_id is not null then
      update public.vehicles set status = 'RENTED' where id = new.vehicle_id;
    elsif new.status = 'RETURNED' and new.vehicle_id is not null then
      -- Shrink the block to the actual return time + buffer so the vehicle frees up early returns.
      select reservation_buffer_minutes into v_buffer from public.tenant_settings where tenant_id = new.tenant_id;
      update public.vehicle_availability_blocks
         set period = tstzrange(lower(period),
                                greatest(lower(period) + interval '1 minute',
                                         coalesce(new.returned_at, now()) + make_interval(mins => coalesce(v_buffer, 0))),
                                '[)')
       where booking_id = new.id and released_at is null
         and coalesce(new.returned_at, now()) + make_interval(mins => coalesce(v_buffer, 0)) < upper(period);
      update public.vehicles set status = 'CLEANING' where id = new.vehicle_id and status = 'RENTED';
    end if;
  end if;
  return null;
end $$;
create trigger after_booking_status after insert or update of status on public.bookings
  for each row execute function app.after_booking_status();
