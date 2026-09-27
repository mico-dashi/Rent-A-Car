-- =====================================================================
-- 0004 BRANCHES & FLEET
-- =====================================================================

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  region text,
  postal_code text,
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  phone text,
  email citext,
  timezone text not null,
  -- {"mon":[{"open":"08:00","close":"20:00"}], ...}
  opening_hours jsonb not null default '{}'::jsonb,
  pickup_instructions text,
  airport_code char(3) check (airport_code ~ '^[A-Z]{3}$'),
  is_airport boolean generated always as (airport_code is not null) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);
create index branches_tenant_idx on public.branches(tenant_id);
select app.install_row_triggers('public.branches');

-- One-way fees between branch pairs (directional).
create table public.one_way_fees (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_branch_id uuid not null,
  to_branch_id uuid not null,
  fee_minor bigint not null check (fee_minor >= 0),
  allowed boolean not null default true,
  primary key (tenant_id, from_branch_id, to_branch_id),
  foreign key (tenant_id, from_branch_id) references public.branches(tenant_id, id) on delete cascade,
  foreign key (tenant_id, to_branch_id) references public.branches(tenant_id, id) on delete cascade,
  check (from_branch_id <> to_branch_id)
);

create table public.vehicle_classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,                       -- e.g. ACRISS code "PDAR" or tenant label
  name text not null,
  category public.vehicle_category not null,
  rank smallint not null default 100,       -- higher rank = higher class (for upgrades)
  equivalence_group text,                   -- tenant-defined substitution group
  daily_rate_minor bigint not null check (daily_rate_minor >= 0),
  deposit_minor bigint not null default 0 check (deposit_minor >= 0),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);
select app.install_row_triggers('public.vehicle_classes');

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  fleet_number text not null,
  vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$'),
  registration_plate text not null,
  make text not null,
  model text not null,
  trim text,
  year smallint not null check (year between 1950 and 2100),
  category public.vehicle_category not null,
  exterior_color text,
  interior_color text,
  transmission public.transmission not null,
  fuel_type public.fuel_type not null,
  drivetrain public.drivetrain,
  seats smallint not null check (seats between 1 and 60),
  doors smallint not null check (doors between 0 and 8),
  luggage smallint check (luggage between 0 and 30),
  engine text,
  horsepower integer check (horsepower between 0 and 3000),
  electric_range_km integer check (electric_range_km between 0 and 2000),
  odometer_km integer not null default 0 check (odometer_km >= 0),
  fuel_level_eighths smallint check (fuel_level_eighths between 0 and 8),
  battery_level_pct smallint check (battery_level_pct between 0 and 100),
  currency char(3) not null references public.currencies(code),
  purchase_price_minor bigint check (purchase_price_minor >= 0),
  estimated_value_minor bigint check (estimated_value_minor >= 0),
  hourly_rate_minor bigint check (hourly_rate_minor >= 0),
  daily_rate_minor bigint not null check (daily_rate_minor >= 0),
  weekly_rate_minor bigint check (weekly_rate_minor >= 0),
  monthly_rate_minor bigint check (monthly_rate_minor >= 0),
  deposit_minor bigint not null default 0 check (deposit_minor >= 0),
  minimum_driver_age smallint not null default 21 check (minimum_driver_age between 16 and 99),
  included_km_per_day integer check (included_km_per_day >= 0), -- null = unlimited
  extra_km_rate_minor bigint not null default 0 check (extra_km_rate_minor >= 0),
  status public.vehicle_status not null default 'AVAILABLE',
  is_published boolean not null default false,
  description text,
  qr_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  rating_avg numeric(3,2) not null default 0 check (rating_avg between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, fleet_number),
  unique (tenant_id, registration_plate),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id),
  check (fuel_type <> 'ELECTRIC' or fuel_level_eighths is null)
);
create unique index vehicles_tenant_vin on public.vehicles(tenant_id, vin) where vin is not null;
create index vehicles_tenant_status_idx on public.vehicles(tenant_id, status);
create index vehicles_tenant_category_idx on public.vehicles(tenant_id, category) where is_published;
create index vehicles_branch_idx on public.vehicles(branch_id);
select app.install_row_triggers('public.vehicles');

create table public.vehicle_class_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  vehicle_id uuid not null,
  primary key (class_id, vehicle_id),
  unique (vehicle_id), -- a vehicle belongs to at most one class
  foreign key (tenant_id, class_id) references public.vehicle_classes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id) on delete cascade
);

create table public.vehicle_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null,
  storage_path text not null,          -- bucket vehicle-media (public, marketing only)
  thumbnail_path text,
  width integer check (width > 0),
  height integer check (height > 0),
  alt_text text,
  kind text not null default 'PHOTO' check (kind in ('PHOTO', 'VIDEO', 'SPIN_360')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id) on delete cascade
);
create index vehicle_images_vehicle_idx on public.vehicle_images(vehicle_id, sort_order);

create table public.vehicle_features (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null,
  feature text not null check (feature ~ '^[a-z_]+$'), -- navigation, bluetooth, apple_carplay, ...
  primary key (vehicle_id, feature),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id) on delete cascade
);

create table public.vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null,
  kind public.document_kind not null,
  storage_path text,                    -- private bucket vehicle-documents
  reference_number text,
  issued_on date,
  expires_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id) on delete cascade,
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index vehicle_documents_expiry_idx on public.vehicle_documents(tenant_id, expires_on) where expires_on is not null;
select app.install_row_triggers('public.vehicle_documents');

create table public.vehicle_status_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null,
  from_status public.vehicle_status,
  to_status public.vehicle_status not null,
  reason text,
  actor_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id) on delete cascade
);
create index vehicle_status_history_vehicle_idx on public.vehicle_status_history(vehicle_id, created_at desc);

create or replace function app.log_vehicle_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.vehicle_status_history (tenant_id, vehicle_id, from_status, to_status, actor_id)
    values (new.tenant_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid());
  end if;
  return new;
end $$;
create trigger log_vehicle_status after insert or update of status on public.vehicles
  for each row execute function app.log_vehicle_status();

-- ---------------------------------------------------------------------
-- OCCUPANCY: every reason a vehicle cannot be rented is a row here.
-- A single GiST exclusion constraint guarantees no two live blocks for
-- the same vehicle overlap -> double bookings are impossible at the
-- database level, regardless of which client or code path inserts.
-- `period` already includes the tenant's reservation buffer.
-- ---------------------------------------------------------------------
create table public.vehicle_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null,
  kind public.block_kind not null,
  period tstzrange not null,
  booking_id uuid,                 -- set when kind = BOOKING (FK added in bookings migration)
  maintenance_id uuid,             -- set when kind = MAINTENANCE / CLEANING
  transfer_id uuid,
  hold_expires_at timestamptz,     -- unpaid booking holds expire
  released_at timestamptz,         -- released blocks no longer occupy the vehicle
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id) on delete cascade,
  check (not isempty(period) and lower_inc(period) and not upper_inc(period)
         and lower(period) is not null and upper(period) is not null),
  check (kind <> 'BOOKING' or booking_id is not null),
  constraint vehicle_blocks_no_overlap exclude using gist (vehicle_id with =, period with &&)
    where (released_at is null)
);
create index vehicle_blocks_vehicle_period_idx on public.vehicle_availability_blocks using gist (vehicle_id, period)
  where released_at is null;
create index vehicle_blocks_tenant_idx on public.vehicle_availability_blocks(tenant_id, kind);
create index vehicle_blocks_booking_idx on public.vehicle_availability_blocks(booking_id) where booking_id is not null;
create index vehicle_blocks_hold_idx on public.vehicle_availability_blocks(hold_expires_at)
  where hold_expires_at is not null and released_at is null;
select app.install_row_triggers('public.vehicle_availability_blocks');

create table public.vehicle_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null,
  from_branch_id uuid not null,
  to_branch_id uuid not null,
  depart_at timestamptz not null,
  arrive_at timestamptz not null,
  driver_membership_id uuid references public.memberships(id) on delete set null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, from_branch_id) references public.branches(tenant_id, id),
  foreign key (tenant_id, to_branch_id) references public.branches(tenant_id, id),
  check (arrive_at > depart_at),
  check (from_branch_id <> to_branch_id)
);
select app.install_row_triggers('public.vehicle_transfers');

-- Transfers occupy the vehicle for their duration.
create or replace function app.sync_transfer_block() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.vehicle_availability_blocks (tenant_id, vehicle_id, kind, period, transfer_id, created_by)
    values (new.tenant_id, new.vehicle_id, 'TRANSFER', tstzrange(new.depart_at, new.arrive_at, '[)'), new.id, auth.uid());
  elsif new.status = 'CANCELLED' then
    update public.vehicle_availability_blocks set released_at = now()
     where transfer_id = new.id and released_at is null;
  elsif new.depart_at <> old.depart_at or new.arrive_at <> old.arrive_at then
    update public.vehicle_availability_blocks set period = tstzrange(new.depart_at, new.arrive_at, '[)')
     where transfer_id = new.id and released_at is null;
  end if;
  if new.status = 'COMPLETED' and (tg_op = 'INSERT' or old.status <> 'COMPLETED') then
    update public.vehicles set branch_id = new.to_branch_id where id = new.vehicle_id;
  end if;
  return new;
end $$;
create trigger sync_transfer_block after insert or update on public.vehicle_transfers
  for each row execute function app.sync_transfer_block();
