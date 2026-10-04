-- =====================================================================
-- 0008 OPERATIONS: agreements, signatures, consent, inspections,
-- damages, maintenance, expenses
-- =====================================================================

create table public.agreement_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null check (version > 0),
  language text not null references public.languages(code),
  body_md text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, language, version)
);

create table public.rental_agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  booking_id uuid not null,
  template_id uuid references public.agreement_templates(id),
  template_version integer not null,
  content_snapshot jsonb not null,   -- all rendered data (vehicle, rates, rules) frozen at generation
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_path text,                     -- private bucket documents
  status text not null default 'GENERATED' check (status in ('GENERATED', 'CUSTOMER_SIGNED', 'FULLY_SIGNED', 'VOID')),
  generated_at timestamptz not null default now(),
  fully_signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id)
);
create unique index rental_agreements_one_live on public.rental_agreements(booking_id) where status <> 'VOID';
select app.install_row_triggers('public.rental_agreements');

create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  agreement_id uuid,
  inspection_id uuid,
  signer_role text not null check (signer_role in ('CUSTOMER', 'EMPLOYEE', 'ADDITIONAL_DRIVER')),
  signer_name text not null,
  signer_user_id uuid references auth.users(id),
  image_path text not null,          -- private bucket documents
  signed_content_sha256 text not null check (signed_content_sha256 ~ '^[0-9a-f]{64}$'),
  ip_address inet,
  user_agent text,
  signed_at timestamptz not null default now(),
  foreign key (tenant_id, agreement_id) references public.rental_agreements(tenant_id, id),
  check (agreement_id is not null or inspection_id is not null)
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  customer_id uuid,
  consent_type text not null check (consent_type in (
    'TERMS', 'PRIVACY', 'MARKETING', 'COOKIES_ANALYTICS', 'RENTAL_AGREEMENT', 'VEHICLE_CONDITION', 'DATA_PROCESSING')),
  policy_version text not null,
  granted boolean not null,
  context jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index consent_records_user_idx on public.consent_records(user_id, consent_type, created_at desc);

-- ---------------- Inspections ----------------
create table public.vehicle_inspections (
  id uuid primary key default gen_random_uuid(),   -- generated client-side for offline creation
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  vehicle_id uuid not null,
  booking_id uuid,
  kind public.inspection_kind not null,
  odometer_km integer not null check (odometer_km >= 0),
  fuel_level_eighths smallint check (fuel_level_eighths between 0 and 8),
  battery_level_pct smallint check (battery_level_pct between 0 and 100),
  checklist jsonb not null default '{}'::jsonb,
  notes text,
  customer_accepted_at timestamptz,
  performed_by uuid not null references auth.users(id),
  performed_at timestamptz not null,                 -- device time of inspection
  client_updated_at timestamptz,                     -- for offline conflict detection
  version integer not null default 1,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'LOCKED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id),
  check (kind = 'ROUTINE' or booking_id is not null)
);
create unique index vehicle_inspections_one_per_kind on public.vehicle_inspections(booking_id, kind)
  where booking_id is not null and kind in ('PICKUP', 'RETURN');
create index vehicle_inspections_vehicle_idx on public.vehicle_inspections(vehicle_id, performed_at desc);
select app.install_row_triggers('public.vehicle_inspections');

-- Conflict-aware offline sync: reject stale writes and edits to locked inspections.
create or replace function app.guard_inspection_update() returns trigger
language plpgsql as $$
begin
  if old.status = 'LOCKED' then
    raise exception 'Inspection is locked' using errcode = 'P0001';
  end if;
  if new.version <> old.version then
    raise exception 'Inspection version conflict (server %, client %)', old.version, new.version
      using errcode = '40001';
  end if;
  new.version := old.version + 1;
  return new;
end $$;
create trigger guard_inspection_update before update on public.vehicle_inspections
  for each row execute function app.guard_inspection_update();

-- Odometer must never go backwards relative to the vehicle record on submission.
create or replace function app.apply_inspection_readings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_odo integer;
begin
  if new.status = 'SUBMITTED' and (tg_op = 'INSERT' or old.status = 'DRAFT') then
    select odometer_km into v_odo from public.vehicles where id = new.vehicle_id for update;
    if new.odometer_km < v_odo then
      raise exception 'Odometer % is lower than last recorded %', new.odometer_km, v_odo using errcode = 'P0001';
    end if;
    update public.vehicles
       set odometer_km = new.odometer_km,
           fuel_level_eighths = coalesce(new.fuel_level_eighths, fuel_level_eighths),
           battery_level_pct = coalesce(new.battery_level_pct, battery_level_pct)
     where id = new.vehicle_id;
  end if;
  return new;
end $$;
create trigger apply_inspection_readings after insert or update of status on public.vehicle_inspections
  for each row execute function app.apply_inspection_readings();

create table public.inspection_photos (
  id uuid primary key default gen_random_uuid(),     -- generated client-side
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  inspection_id uuid not null,
  slot text not null check (slot in ('FRONT', 'REAR', 'DRIVER_SIDE', 'PASSENGER_SIDE', 'WHEELS', 'ROOF', 'INTERIOR', 'DASHBOARD', 'DAMAGE', 'OTHER')),
  storage_path text not null,       -- private bucket inspection-photos
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, inspection_id) references public.vehicle_inspections(tenant_id, id) on delete cascade
);
create index inspection_photos_inspection_idx on public.inspection_photos(inspection_id);

create table public.vehicle_damages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  vehicle_id uuid not null,
  booking_id uuid,
  inspection_id uuid,
  damage_type text not null check (damage_type in ('SCRATCH', 'DENT', 'CRACK', 'CHIP', 'TEAR', 'STAIN', 'MISSING_PART', 'MECHANICAL', 'OTHER')),
  location text,                    -- e.g. "front bumper left"
  description text not null,
  photo_paths text[] not null default '{}',
  discovered_by uuid references auth.users(id),
  discovered_at timestamptz not null default now(),
  is_pre_existing boolean not null default false,
  estimated_cost_minor bigint check (estimated_cost_minor >= 0),
  actual_cost_minor bigint check (actual_cost_minor >= 0),
  currency char(3),
  responsibility text check (responsibility in ('CUSTOMER', 'COMPANY', 'INSURANCE', 'THIRD_PARTY', 'UNDETERMINED')),
  status public.damage_status not null default 'REPORTED',
  -- Human decision record: required before any customer charge
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  charge_payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id),
  foreign key (tenant_id, inspection_id) references public.vehicle_inspections(tenant_id, id),
  check (status <> 'CUSTOMER_RESPONSIBLE' or (decided_by is not null and decided_at is not null)),
  check (charge_payment_id is null or status in ('CUSTOMER_RESPONSIBLE', 'REPAIR_SCHEDULED', 'REPAIRED', 'CLOSED'))
);
create index vehicle_damages_vehicle_idx on public.vehicle_damages(vehicle_id, discovered_at desc);
create index vehicle_damages_tenant_status_idx on public.vehicle_damages(tenant_id, status);
select app.install_row_triggers('public.vehicle_damages');

-- Optional AI damage assist (feature flag `ai_damage_assist`). Advisory only:
-- no column here can trigger a charge; a human decision on vehicle_damages is required.
create table public.damage_ai_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pickup_inspection_id uuid not null,
  return_inspection_id uuid not null,
  model text not null,
  model_version text not null,
  findings jsonb not null,          -- [{slot, bbox, label, confidence}]
  max_confidence numeric(4,3) check (max_confidence between 0 and 1),
  review_status text not null default 'PENDING_REVIEW' check (review_status in ('PENDING_REVIEW', 'CONFIRMED', 'DISMISSED')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  resulting_damage_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, pickup_inspection_id) references public.vehicle_inspections(tenant_id, id),
  foreign key (tenant_id, return_inspection_id) references public.vehicle_inspections(tenant_id, id),
  check (review_status = 'PENDING_REVIEW' or reviewed_by is not null)
);

-- ---------------- Maintenance ----------------
create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  vehicle_id uuid not null,
  type public.maintenance_type not null,
  custom_type text,
  provider text,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  completed_at timestamptz,
  odometer_km integer check (odometer_km >= 0),
  cost_minor bigint check (cost_minor >= 0),
  currency char(3),
  invoice_path text,
  notes text,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id),
  check (scheduled_end > scheduled_start),
  check (type <> 'CUSTOM' or custom_type is not null),
  check (cost_minor is null or currency is not null)
);
create index maintenance_vehicle_idx on public.maintenance_records(vehicle_id, scheduled_start);
select app.install_row_triggers('public.maintenance_records');

-- Maintenance automatically blocks availability. If the window overlaps a
-- booking, the exclusion constraint rejects it: staff must reassign first.
create or replace function app.sync_maintenance_block() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.block_kind := case when new.type = 'CLEANING' then 'CLEANING' else 'MAINTENANCE' end;
begin
  if tg_op = 'INSERT' then
    if new.status in ('SCHEDULED', 'IN_PROGRESS') then
      insert into public.vehicle_availability_blocks (tenant_id, vehicle_id, kind, period, maintenance_id, created_by, reason)
      values (new.tenant_id, new.vehicle_id, v_kind, tstzrange(new.scheduled_start, new.scheduled_end, '[)'),
              new.id, auth.uid(), new.type::text);
    end if;
  elsif new.status in ('CANCELLED', 'COMPLETED') and old.status not in ('CANCELLED', 'COMPLETED') then
    update public.vehicle_availability_blocks
       set released_at = case when new.status = 'CANCELLED' or coalesce(new.completed_at, now()) <= lower(period)
                              then now() else released_at end,
           period = case when new.status = 'COMPLETED' and coalesce(new.completed_at, now()) > lower(period)
                              and coalesce(new.completed_at, now()) < upper(period)
                         then tstzrange(lower(period), coalesce(new.completed_at, now()), '[)') else period end
     where maintenance_id = new.id and released_at is null;
    if new.status = 'COMPLETED' then
      update public.vehicles set status = 'AVAILABLE' where id = new.vehicle_id and status in ('MAINTENANCE', 'CLEANING');
    end if;
  elsif new.scheduled_start <> old.scheduled_start or new.scheduled_end <> old.scheduled_end then
    update public.vehicle_availability_blocks
       set period = tstzrange(new.scheduled_start, new.scheduled_end, '[)')
     where maintenance_id = new.id and released_at is null;
  end if;
  if new.status = 'IN_PROGRESS' and (tg_op = 'INSERT' or old.status <> 'IN_PROGRESS') then
    update public.vehicles set status = case when new.type = 'CLEANING' then 'CLEANING'::public.vehicle_status
                                             else 'MAINTENANCE'::public.vehicle_status end
     where id = new.vehicle_id;
  end if;
  return new;
end $$;
create trigger sync_maintenance_block after insert or update on public.maintenance_records
  for each row execute function app.sync_maintenance_block();

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  vehicle_id uuid,
  branch_id uuid,
  maintenance_id uuid references public.maintenance_records(id) on delete set null,
  category public.expense_category not null,
  description text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null references public.currencies(code),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  incurred_on date not null,
  vendor text,
  receipt_path text,
  external_ref text,                -- accounting export id
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id)
);
create index expenses_tenant_date_idx on public.expenses(tenant_id, incurred_on desc);
select app.install_row_triggers('public.expenses');
