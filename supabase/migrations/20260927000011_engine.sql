-- =====================================================================
-- 0011 ENGINE: onboarding, tenant resolution, catalogue, availability,
-- booking lifecycle RPCs.
-- Error contract: business errors raise SQLSTATE 'P0001' with a stable
-- UPPER_SNAKE code as the message; the API layer maps these to HTTP.
-- =====================================================================

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
create policy platform_admin_all on public.platform_settings for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
grant select, insert, update, delete on public.platform_settings to authenticated, service_role;
insert into public.platform_settings (key, value) values
  ('root_domain', '"myplatform.com"'),
  ('tenants_auto_approve', 'false'),
  ('max_tenants_per_user', '3'),
  ('default_plan_key', '"starter"');

-- True when the request comes from trusted server code: a service_role JWT,
-- or a direct database session with no JWT at all (migrations, cron, psql).
-- Unlike current_user, this is reliable inside SECURITY DEFINER functions.
create or replace function app.is_service_call() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') = 'service_role'
$$;
grant execute on function app.is_service_call() to authenticated, anon, service_role;

create or replace function app.setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.platform_settings where key = p_key
$$;

-- Permission check for an explicit user (used by service-role RPCs that act on behalf of a user).
create or replace function app.user_has_permission(p_user uuid, p_tenant uuid, p_permission text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_membership public.memberships;
  v_tenant_status public.tenant_status;
  v_override boolean;
begin
  if p_user is null or p_tenant is null then return false; end if;
  select status into v_tenant_status from public.tenants where id = p_tenant;
  if v_tenant_status is null or v_tenant_status = 'ARCHIVED'
     or (v_tenant_status = 'SUSPENDED' and p_permission not like '%.read') then
    return false;
  end if;
  select * into v_membership from public.memberships
   where tenant_id = p_tenant and user_id = p_user and status = 'ACTIVE';
  if not found then return false; end if;
  select granted into v_override from public.membership_permission_overrides
   where membership_id = v_membership.id and permission = p_permission;
  if found then return v_override; end if;
  return exists (select 1 from public.role_permissions rp where rp.role = v_membership.role and rp.permission = p_permission);
end $$;

create or replace function app.has_permission(p_tenant uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.user_has_permission(auth.uid(), p_tenant, p_permission)
$$;

-- ---------------------------------------------------------------------
-- New auth user -> profile
-- ---------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (new.id, new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------
-- Tenant onboarding (step 1). Creates tenant + settings + branding +
-- owner membership + trial subscription + platform subdomain atomically.
-- ---------------------------------------------------------------------
create or replace function public.create_tenant(
  p_slug text, p_display_name text, p_legal_name text, p_country char(2),
  p_currency char(3), p_language text, p_timezone text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_plan public.subscription_plans;
  v_root text := app.setting('root_domain') #>> '{}';
  v_count integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select count(*) into v_count from public.tenants where owner_user_id = v_user and status <> 'ARCHIVED';
  if v_count >= coalesce((app.setting('max_tenants_per_user'))::int, 3) then
    raise exception 'TENANT_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if p_timezone not in (select name from pg_timezone_names) then
    raise exception 'INVALID_TIMEZONE' using errcode = 'P0001';
  end if;

  insert into public.tenants (slug, legal_name, display_name, country_code, base_currency, default_language, owner_user_id, status)
  values (lower(p_slug), p_legal_name, p_display_name, upper(p_country), upper(p_currency), p_language, v_user,
          (case when coalesce((app.setting('tenants_auto_approve'))::boolean, false) then 'ACTIVE' else 'PENDING_APPROVAL' end)::public.tenant_status)
  returning id into v_tenant;

  insert into public.tenant_settings (tenant_id, timezone, onboarding_step) values (v_tenant, p_timezone, 2);
  insert into public.tenant_branding (tenant_id, email_from_name) values (v_tenant, p_display_name);
  insert into public.memberships (tenant_id, user_id, role, status) values (v_tenant, v_user, 'TENANT_OWNER', 'ACTIVE');
  insert into public.tenant_domains (tenant_id, hostname, is_platform_subdomain, is_primary, status, verified_at)
  values (v_tenant, lower(p_slug) || '.' || v_root, true, true, 'VERIFIED', now());

  select * into v_plan from public.subscription_plans where key = (app.setting('default_plan_key') #>> '{}');
  if found then
    insert into public.tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    values (v_tenant, v_plan.id, 'TRIALING', now() + make_interval(days => v_plan.trial_days), now(),
            now() + make_interval(days => v_plan.trial_days));
  end if;
  return v_tenant;
end $$;

-- Staff invitation acceptance. Token is delivered by email; only its hash is stored.
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_membership public.memberships;
  v_email text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select email into v_email from auth.users where id = auth.uid();
  select * into v_membership from public.memberships
   where invite_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and status = 'INVITED' and user_id is null
   for update;
  if not found or v_membership.invite_expires_at < now() then
    raise exception 'INVITATION_INVALID' using errcode = 'P0001';
  end if;
  if lower(v_membership.invited_email) <> lower(v_email) then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = 'P0001';
  end if;
  update public.memberships set user_id = auth.uid(), status = 'ACTIVE', invite_token_hash = null
   where id = v_membership.id;
  return v_membership.tenant_id;
end $$;

-- ---------------------------------------------------------------------
-- Tenant resolution for web middleware and the universal mobile app.
-- Returns only public storefront configuration of ACTIVE tenants.
-- ---------------------------------------------------------------------
create or replace function public.resolve_tenant(p_hostname text default null, p_slug text default null, p_code text default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'displayName', t.display_name, 'countryCode', t.country_code,
    'currency', t.base_currency, 'language', t.default_language, 'timezone', s.timezone,
    'bookingMode', s.booking_mode, 'bufferMinutes', s.reservation_buffer_minutes,
    'freeCancellationHours', s.free_cancellation_hours, 'lateCancellationFeeBps', s.late_cancellation_fee_bps,
    'paymentTiming', s.payment_timing, 'fuelPolicy', s.fuel_policy, 'minDriverAge', s.default_min_driver_age,
    'branding', jsonb_build_object(
      'primaryColor', b.primary_color, 'secondaryColor', b.secondary_color, 'backgroundColor', b.background_color,
      'fontHeading', b.font_heading, 'fontBody', b.font_body, 'logoPath', b.logo_path, 'logoDarkPath', b.logo_dark_path,
      'appIconPath', b.app_icon_path, 'splashPath', b.splash_path, 'heroImagePath', b.hero_image_path,
      'headline', b.headline, 'subheadline', b.subheadline, 'aboutMd', b.about_md, 'contactEmail', b.contact_email,
      'contactPhone', b.contact_phone, 'contactAddress', b.contact_address, 'socialLinks', b.social_links,
      'faq', b.faq, 'hidePlatformBranding', b.hide_platform_branding, 'defaultTheme', b.default_theme),
    'primaryHostname', (select d2.hostname::text from public.tenant_domains d2
                         where d2.tenant_id = t.id and d2.is_primary and d2.status = 'VERIFIED'))
  from public.tenants t
  join public.tenant_settings s on s.tenant_id = t.id
  join public.tenant_branding b on b.tenant_id = t.id
  where t.status = 'ACTIVE'
    and (
      (p_hostname is not null and exists (select 1 from public.tenant_domains d
         where d.tenant_id = t.id and d.hostname = lower(p_hostname)::extensions.citext and d.status = 'VERIFIED'))
      or (p_slug is not null and t.slug = lower(p_slug))
      or (p_code is not null and t.tenant_code = upper(p_code)))
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- Public catalogue (safe columns only). Owned by postgres so it can read
-- the staff-only vehicles table; filters to published vehicles of ACTIVE tenants.
-- ---------------------------------------------------------------------
create view public.catalog_vehicles with (security_barrier = true) as
select v.id, v.tenant_id, v.branch_id, v.make, v.model, v.trim, v.year, v.category, v.exterior_color,
       v.transmission, v.fuel_type, v.drivetrain, v.seats, v.doors, v.luggage, v.engine, v.horsepower,
       v.electric_range_km, v.currency, v.daily_rate_minor, v.weekly_rate_minor, v.monthly_rate_minor,
       v.hourly_rate_minor, v.deposit_minor, v.minimum_driver_age, v.included_km_per_day, v.extra_km_rate_minor,
       v.description, v.rating_avg, v.rating_count, v.created_at,
       (select coalesce(array_agg(f.feature order by f.feature), '{}') from public.vehicle_features f where f.vehicle_id = v.id) as features,
       (select i.thumbnail_path from public.vehicle_images i where i.vehicle_id = v.id and i.kind = 'PHOTO'
         order by i.sort_order limit 1) as thumbnail_path,
       (select m.class_id from public.vehicle_class_members m where m.vehicle_id = v.id) as class_id
from public.vehicles v
join public.tenants t on t.id = v.tenant_id and t.status = 'ACTIVE'
where v.is_published and v.status not in ('INACTIVE', 'SOLD');
grant select on public.catalog_vehicles to anon, authenticated;

-- ---------------------------------------------------------------------
-- Availability
-- ---------------------------------------------------------------------
create or replace function app.buffer_minutes(p_tenant uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select reservation_buffer_minutes from public.tenant_settings where tenant_id = p_tenant), 0)
$$;

-- The occupancy range a rental of [start, end) needs, including the turnaround buffer.
create or replace function app.occupancy_range(p_tenant uuid, p_start timestamptz, p_end timestamptz) returns tstzrange
language sql stable as $$
  select tstzrange(p_start, p_end + make_interval(mins => app.buffer_minutes(p_tenant)), '[)')
$$;

create or replace function app.vehicle_is_free(p_vehicle uuid, p_range tstzrange, p_ignore_booking uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.vehicle_availability_blocks b
    where b.vehicle_id = p_vehicle and b.released_at is null and b.period && p_range
      and (b.hold_expires_at is null or b.hold_expires_at > now())
      and (p_ignore_booking is null or b.booking_id is distinct from p_ignore_booking))
$$;

-- Free vehicles in a class for a range minus unassigned class bookings overlapping it.
create or replace function app.class_spare_capacity(p_class uuid, p_range tstzrange) returns integer
language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from public.vehicle_class_members m join public.vehicles v on v.id = m.vehicle_id
      where m.class_id = p_class and v.status not in ('INACTIVE', 'SOLD', 'DAMAGED')
        and app.vehicle_is_free(v.id, p_range))::int
    -
    (select count(*) from public.bookings bk
      where bk.vehicle_class_id = p_class and bk.vehicle_id is null
        and bk.status not in ('CANCELLED', 'NO_SHOW', 'RETURNED', 'COMPLETED', 'DRAFT', 'QUOTE')
        and app.occupancy_range(bk.tenant_id, bk.starts_at, bk.ends_at) && p_range)::int
$$;

create or replace function app.validate_rental_window(p_tenant uuid, p_start timestamptz, p_end timestamptz, p_is_staff boolean)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  s public.tenant_settings;
begin
  select * into s from public.tenant_settings where tenant_id = p_tenant;
  if p_end <= p_start then raise exception 'INVALID_RENTAL_WINDOW' using errcode = 'P0001'; end if;
  if extract(epoch from (p_end - p_start)) / 60 < s.min_rental_minutes then
    raise exception 'RENTAL_TOO_SHORT' using errcode = 'P0001';
  end if;
  if p_end - p_start > make_interval(days => s.max_rental_days) then
    raise exception 'RENTAL_TOO_LONG' using errcode = 'P0001';
  end if;
  if not p_is_staff and p_start < now() + make_interval(mins => s.min_lead_time_minutes) then
    raise exception 'LEAD_TIME_NOT_MET' using errcode = 'P0001';
  end if;
end $$;

-- Public search: only vehicles that are genuinely free (incl. buffer) at the pickup branch.
create or replace function public.search_available_vehicles(
  p_tenant uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_pickup_branch uuid,
  p_category public.vehicle_category default null, p_limit integer default 50, p_offset integer default 0
) returns setof public.catalog_vehicles
language plpgsql stable security definer set search_path = '' as $$
declare
  v_range tstzrange;
begin
  if not app.tenant_is_public(p_tenant) then return; end if;
  perform app.validate_rental_window(p_tenant, p_starts_at, p_ends_at, false);
  v_range := app.occupancy_range(p_tenant, p_starts_at, p_ends_at);
  return query
    select c.* from public.catalog_vehicles c
    join public.vehicles v on v.id = c.id
    where c.tenant_id = p_tenant
      and c.branch_id = p_pickup_branch
      and v.status <> 'DAMAGED'
      and (p_category is null or c.category = p_category)
      and app.vehicle_is_free(c.id, v_range)
      and (c.class_id is null or app.class_spare_capacity(c.class_id, v_range) > 0)
    order by c.daily_rate_minor, c.id
    limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create or replace function public.is_vehicle_available(p_vehicle uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.catalog_vehicles c where c.id = p_vehicle)
     and app.vehicle_is_free(p_vehicle, app.occupancy_range((select tenant_id from public.vehicles where id = p_vehicle), p_starts_at, p_ends_at))
$$;

-- Release expired unpaid holds (called by cron and opportunistically before booking).
create or replace function public.release_expired_holds(p_vehicle uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select b.id as block_id, b.booking_id from public.vehicle_availability_blocks b
    where b.released_at is null and b.hold_expires_at is not null and b.hold_expires_at <= now()
      and (p_vehicle is null or b.vehicle_id = p_vehicle)
    for update skip locked
  loop
    update public.vehicle_availability_blocks set released_at = now() where id = r.block_id;
    perform set_config('app.transition_reason', 'HOLD_EXPIRED', true);
    update public.bookings set status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'HOLD_EXPIRED'
     where id = r.booking_id and status = 'PENDING_PAYMENT';
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Booking creation. SERVICE ROLE ONLY: the API route authenticates the
-- user, prices the booking with @rental/domain and passes the result.
-- This function re-validates every invariant that matters for money and
-- occupancy; the exclusion constraint is the final arbiter.
-- ---------------------------------------------------------------------
create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_actor uuid := (p ->> 'actor_user_id')::uuid;
  v_customer public.customers;
  v_vehicle public.vehicles;
  v_class_id uuid := (p ->> 'vehicle_class_id')::uuid;
  v_vehicle_id uuid := (p ->> 'vehicle_id')::uuid;
  v_start timestamptz := (p ->> 'starts_at')::timestamptz;
  v_end timestamptz := (p ->> 'ends_at')::timestamptz;
  v_status public.booking_status := coalesce((p ->> 'initial_status')::public.booking_status, 'PENDING_PAYMENT');
  v_is_staff boolean;
  v_settings public.tenant_settings;
  v_tenant_row public.tenants;
  v_range tstzrange;
  v_booking public.bookings;
  v_block uuid;
  v_lines_total bigint;
  v_line jsonb;
  v_extra jsonb;
  v_i integer := 0;
  v_mode public.booking_mode;
begin
  if p ->> 'idempotency_key' is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001'; end if;

  -- Idempotent replay
  select * into v_booking from public.bookings where tenant_id = v_tenant and idempotency_key = p ->> 'idempotency_key';
  if found then
    return jsonb_build_object('id', v_booking.id, 'reference', v_booking.reference, 'status', v_booking.status, 'replayed', true);
  end if;

  select * into v_tenant_row from public.tenants where id = v_tenant;
  if not found or v_tenant_row.status <> 'ACTIVE' then raise exception 'TENANT_NOT_ACTIVE' using errcode = 'P0001'; end if;
  select * into v_settings from public.tenant_settings where tenant_id = v_tenant;

  select * into v_customer from public.customers where id = (p ->> 'customer_id')::uuid and tenant_id = v_tenant;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_customer.is_restricted then raise exception 'CUSTOMER_RESTRICTED' using errcode = 'P0001'; end if;

  v_is_staff := app.user_has_permission(v_actor, v_tenant, 'bookings.write');
  if not v_is_staff and (v_customer.user_id is null or v_customer.user_id <> v_actor) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not v_is_staff and v_status not in ('PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED') then
    raise exception 'INVALID_INITIAL_STATUS' using errcode = 'P0001';
  end if;
  -- Customers may only skip payment when the tenant allows pay-at-pickup
  if not v_is_staff and v_status in ('CONFIRMED', 'PENDING_APPROVAL') and v_settings.payment_timing <> 'PAY_AT_PICKUP' then
    raise exception 'PAYMENT_REQUIRED' using errcode = 'P0001';
  end if;
  if v_status = 'CONFIRMED' and v_settings.requires_manual_approval and not v_is_staff then
    v_status := 'PENDING_APPROVAL';
  end if;

  perform app.validate_rental_window(v_tenant, v_start, v_end, v_is_staff);

  if not exists (select 1 from public.branches where id = (p ->> 'pickup_branch_id')::uuid and tenant_id = v_tenant and is_active)
     or not exists (select 1 from public.branches where id = (p ->> 'return_branch_id')::uuid and tenant_id = v_tenant and is_active) then
    raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if (p ->> 'pickup_branch_id') <> (p ->> 'return_branch_id') and exists (
       select 1 from public.one_way_fees f where f.tenant_id = v_tenant and f.from_branch_id = (p ->> 'pickup_branch_id')::uuid
         and f.to_branch_id = (p ->> 'return_branch_id')::uuid and not f.allowed) then
    raise exception 'ONE_WAY_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  -- Money invariants
  if (p ->> 'currency') is distinct from v_tenant_row.base_currency then raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001'; end if;
  select coalesce(sum((l ->> 'amount_minor')::bigint), 0) into v_lines_total from jsonb_array_elements(p -> 'lines') l;
  if v_lines_total <> (p ->> 'total_minor')::bigint or (p ->> 'total_minor')::bigint < 0 then
    raise exception 'PRICE_LINES_MISMATCH' using errcode = 'P0001';
  end if;

  if v_vehicle_id is not null then
    v_mode := 'EXACT_VEHICLE';
    select * into v_vehicle from public.vehicles where id = v_vehicle_id and tenant_id = v_tenant for share;
    if not found or v_vehicle.status in ('INACTIVE', 'SOLD', 'DAMAGED') or (not v_vehicle.is_published and not v_is_staff) then
      raise exception 'VEHICLE_NOT_BOOKABLE' using errcode = 'P0001';
    end if;
    if v_vehicle.branch_id <> (p ->> 'pickup_branch_id')::uuid and not v_is_staff then
      raise exception 'VEHICLE_NOT_AT_BRANCH' using errcode = 'P0001';
    end if;
    select class_id into v_class_id from public.vehicle_class_members where vehicle_id = v_vehicle_id;
  elsif v_class_id is not null then
    v_mode := 'VEHICLE_CLASS';
    if not exists (select 1 from public.vehicle_classes where id = v_class_id and tenant_id = v_tenant) then
      raise exception 'CLASS_NOT_FOUND' using errcode = 'P0001';
    end if;
  else
    raise exception 'VEHICLE_OR_CLASS_REQUIRED' using errcode = 'P0001';
  end if;

  v_range := app.occupancy_range(v_tenant, v_start, v_end);

  -- Serialize class-capacity decisions for this class.
  if v_class_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('class:' || v_class_id::text, 0));
  end if;
  if v_vehicle_id is not null then
    perform public.release_expired_holds(v_vehicle_id);
  else
    perform public.release_expired_holds(null);
  end if;

  insert into public.bookings (
    tenant_id, customer_id, mode, vehicle_id, vehicle_class_id, pickup_branch_id, return_branch_id, pickup_type,
    delivery_address, delivery_latitude, delivery_longitude, starts_at, ends_at, status, currency,
    rental_minor, extras_minor, fees_minor, discount_minor, tax_minor, total_minor, deposit_minor, due_now_minor,
    pricing_snapshot, discount_code_id, included_km, driver_age, additional_drivers, customer_notes, idempotency_key,
    confirmed_at, created_by)
  values (
    v_tenant, v_customer.id, v_mode, v_vehicle_id, v_class_id, (p ->> 'pickup_branch_id')::uuid, (p ->> 'return_branch_id')::uuid,
    coalesce((p ->> 'pickup_type')::public.pickup_type, 'BRANCH'), p ->> 'delivery_address',
    (p ->> 'delivery_latitude')::numeric, (p ->> 'delivery_longitude')::numeric, v_start, v_end, 'DRAFT', p ->> 'currency',
    coalesce((p ->> 'rental_minor')::bigint, 0), coalesce((p ->> 'extras_minor')::bigint, 0), coalesce((p ->> 'fees_minor')::bigint, 0),
    coalesce((p ->> 'discount_minor')::bigint, 0), coalesce((p ->> 'tax_minor')::bigint, 0), (p ->> 'total_minor')::bigint,
    coalesce((p ->> 'deposit_minor')::bigint, 0), coalesce((p ->> 'due_now_minor')::bigint, 0),
    coalesce(p -> 'pricing_snapshot', '{}'::jsonb), (p ->> 'discount_code_id')::uuid, (p ->> 'included_km')::int,
    (p ->> 'driver_age')::smallint, coalesce((p ->> 'additional_drivers')::smallint, 0), p ->> 'customer_notes',
    p ->> 'idempotency_key', null, v_actor)
  returning * into v_booking;

  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    insert into public.booking_price_lines (tenant_id, booking_id, kind, label, quantity, unit_amount_minor, amount_minor,
                                            is_taxable, source_rule_id, sort_order)
    values (v_tenant, v_booking.id, (v_line ->> 'kind')::public.price_line_kind, v_line ->> 'label',
            coalesce((v_line ->> 'quantity')::numeric, 1), (v_line ->> 'unit_amount_minor')::bigint,
            (v_line ->> 'amount_minor')::bigint, coalesce((v_line ->> 'is_taxable')::boolean, true),
            (v_line ->> 'source_rule_id')::uuid, v_i);
    v_i := v_i + 1;
  end loop;

  for v_extra in select * from jsonb_array_elements(coalesce(p -> 'extras', '[]'::jsonb)) loop
    insert into public.booking_extras (tenant_id, booking_id, extra_id, name_snapshot, billing, quantity, unit_price_minor, total_minor)
    select v_tenant, v_booking.id, e.id, e.name, e.billing, (v_extra ->> 'quantity')::smallint,
           (v_extra ->> 'unit_price_minor')::bigint, (v_extra ->> 'total_minor')::bigint
      from public.extras e where e.id = (v_extra ->> 'extra_id')::uuid and e.tenant_id = v_tenant and e.is_active;
    if not found then raise exception 'EXTRA_NOT_FOUND' using errcode = 'P0001'; end if;
  end loop;

  if (p ->> 'discount_code_id') is not null then
    update public.discount_codes set redemptions = redemptions + 1
     where id = (p ->> 'discount_code_id')::uuid and tenant_id = v_tenant and is_active
       and (valid_until is null or valid_until > now()) and (max_redemptions is null or redemptions < max_redemptions);
    if not found then raise exception 'DISCOUNT_CODE_INVALID' using errcode = 'P0001'; end if;
  end if;

  -- Occupancy. The exclusion constraint makes this race-free.
  if v_vehicle_id is not null then
    begin
      insert into public.vehicle_availability_blocks (tenant_id, vehicle_id, kind, period, booking_id, hold_expires_at, created_by)
      values (v_tenant, v_vehicle_id, 'BOOKING', v_range, v_booking.id,
              case when v_status = 'PENDING_PAYMENT' then now() + make_interval(mins => v_settings.hold_minutes) end, v_actor)
      returning id into v_block;
    exception when exclusion_violation then
      raise exception 'VEHICLE_UNAVAILABLE' using errcode = 'P0001';
    end;
    insert into public.booking_vehicle_assignments (tenant_id, booking_id, vehicle_id, block_id, reason, assigned_by)
    values (v_tenant, v_booking.id, v_vehicle_id, v_block, 'INITIAL', v_actor);
  end if;

  -- Class capacity must remain non-negative after this booking.
  -- (The new booking is still DRAFT here, so an unassigned class booking must leave >= 1 spare.)
  if v_class_id is not null then
    if app.class_spare_capacity(v_class_id, v_range) < (case when v_vehicle_id is null then 1 else 0 end) then
      raise exception 'CLASS_SOLD_OUT' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('app.transition_reason', 'CREATED', true);
  update public.bookings set status = v_status, confirmed_at = case when v_status = 'CONFIRMED' then now() end
   where id = v_booking.id;

  return jsonb_build_object('id', v_booking.id, 'reference', v_booking.reference, 'status', v_status, 'replayed', false,
                            'hold_expires_at', case when v_status = 'PENDING_PAYMENT' then now() + make_interval(mins => v_settings.hold_minutes) end);
end $$;

-- Called by the payment webhook handler after a verified successful payment.
create or replace function public.record_booking_payment(p_booking uuid, p_amount_minor bigint, p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  s public.tenant_settings;
  v_range tstzrange;
  v_next public.booking_status;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.payments where id = p_payment_id and booking_id = p_booking and status = 'SUCCEEDED') then
    raise exception 'PAYMENT_NOT_SUCCEEDED' using errcode = 'P0001';
  end if;
  select * into s from public.tenant_settings where tenant_id = b.tenant_id;

  update public.bookings set
    amount_paid_minor = (select coalesce(sum(amount_captured_minor), 0) from public.payments
                          where booking_id = p_booking and purpose = 'RENTAL' and status = 'SUCCEEDED'),
    payment_status = case
      when (select coalesce(sum(amount_captured_minor), 0) from public.payments
             where booking_id = p_booking and purpose = 'RENTAL' and status = 'SUCCEEDED') >= b.total_minor then 'PAID'::public.payment_status
      else 'PARTIALLY_PAID'::public.payment_status end
  where id = p_booking;

  if b.status = 'PENDING_PAYMENT' or (b.status = 'CANCELLED' and b.cancellation_reason = 'HOLD_EXPIRED') then
    if b.status = 'CANCELLED' then
      -- Hold expired before payment landed: try to re-acquire the vehicle. Caller refunds on failure.
      v_range := app.occupancy_range(b.tenant_id, b.starts_at, b.ends_at);
      if b.vehicle_id is null or not app.vehicle_is_free(b.vehicle_id, v_range) then
        return jsonb_build_object('status', 'HOLD_LOST', 'refund_required', true);
      end if;
      insert into public.vehicle_availability_blocks (tenant_id, vehicle_id, kind, period, booking_id)
      values (b.tenant_id, b.vehicle_id, 'BOOKING', v_range, b.id);
      -- CANCELLED is terminal in the state machine; reinstate through the trusted path only.
      perform set_config('app.transition_reason', 'REINSTATED_AFTER_LATE_PAYMENT', true);
      perform set_config('app.allow_reinstate', 'on', true);
      update public.bookings set status = 'PENDING_PAYMENT', cancelled_at = null, cancellation_reason = null where id = b.id;
      perform set_config('app.allow_reinstate', '', true);
    end if;
    v_next := case when s.requires_manual_approval then 'PENDING_APPROVAL' else 'CONFIRMED' end;
    perform set_config('app.transition_reason', 'PAYMENT_RECEIVED', true);
    update public.bookings set status = v_next, confirmed_at = case when v_next = 'CONFIRMED' then now() end where id = b.id;
    return jsonb_build_object('status', v_next, 'refund_required', false);
  end if;
  return jsonb_build_object('status', b.status, 'refund_required', false);
end $$;

-- ---------------------------------------------------------------------
-- Status transitions with role-aware authorization.
-- ---------------------------------------------------------------------
create or replace function public.transition_booking(
  p_booking uuid, p_to public.booking_status, p_reason text default null, p_expected_version integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  s public.tenant_settings;
  v_uid uuid := auth.uid();
  v_trusted boolean := app.is_service_call();
  v_is_owner_customer boolean;
  v_fee bigint := 0;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001'; end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_status_transitions t where t.from_status = b.status and t.to_status = p_to) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  select * into s from public.tenant_settings where tenant_id = b.tenant_id;
  v_is_owner_customer := exists (select 1 from public.customers c where c.id = b.customer_id and c.user_id = v_uid);

  if not v_trusted then
    if p_to = 'CANCELLED' then
      if not (app.has_permission(b.tenant_id, 'bookings.cancel')
              or (v_is_owner_customer and b.starts_at > now()
                  and b.status in ('DRAFT', 'QUOTE', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'CHECK_IN_PENDING', 'READY_FOR_PICKUP'))) then
        raise exception 'FORBIDDEN' using errcode = 'P0001';
      end if;
    elsif p_to in ('NO_SHOW', 'DISPUTED') then
      if not app.has_permission(b.tenant_id, 'bookings.override') and not app.has_permission(b.tenant_id, 'bookings.cancel') then
        raise exception 'FORBIDDEN' using errcode = 'P0001';
      end if;
      if p_to = 'NO_SHOW' and now() < b.starts_at then raise exception 'NO_SHOW_TOO_EARLY' using errcode = 'P0001'; end if;
    else
      if not app.has_permission(b.tenant_id, 'bookings.write') then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
      if not app.has_branch_access(b.tenant_id, b.pickup_branch_id) then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
    end if;

    -- Pickup gate: identity, payment, inspection and signed agreement.
    if p_to = 'ACTIVE' and not app.has_permission(b.tenant_id, 'bookings.override') then
      if b.vehicle_id is null then raise exception 'VEHICLE_NOT_ASSIGNED' using errcode = 'P0001'; end if;
      if not exists (select 1 from public.vehicle_inspections i where i.booking_id = b.id and i.kind = 'PICKUP'
                     and i.status in ('SUBMITTED', 'LOCKED') and i.customer_accepted_at is not null) then
        raise exception 'PICKUP_INSPECTION_REQUIRED' using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.rental_agreements a where a.booking_id = b.id and a.status = 'FULLY_SIGNED') then
        raise exception 'AGREEMENT_SIGNATURE_REQUIRED' using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.driver_licenses d where d.customer_id = b.customer_id
                     and d.verification_status = 'VERIFIED' and d.expires_on >= (b.ends_at at time zone 'UTC')::date) then
        raise exception 'LICENSE_NOT_VERIFIED' using errcode = 'P0001';
      end if;
      if s.payment_timing <> 'PAY_AT_PICKUP' and b.payment_status not in ('PAID') then
        raise exception 'PAYMENT_INCOMPLETE' using errcode = 'P0001';
      end if;
      if b.deposit_minor > 0 and not exists (select 1 from public.security_deposits d where d.booking_id = b.id
                                             and d.status in ('AUTHORIZED', 'NOT_REQUIRED')) then
        raise exception 'DEPOSIT_NOT_SECURED' using errcode = 'P0001';
      end if;
    end if;
    if p_to = 'RETURNED' and not exists (select 1 from public.vehicle_inspections i where i.booking_id = b.id
                                         and i.kind = 'RETURN' and i.status in ('SUBMITTED', 'LOCKED')) then
      raise exception 'RETURN_INSPECTION_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  if p_to = 'CANCELLED' and b.status in ('CONFIRMED', 'CHECK_IN_PENDING', 'READY_FOR_PICKUP', 'PENDING_APPROVAL')
     and now() > b.starts_at - make_interval(hours => s.free_cancellation_hours) then
    v_fee := (b.total_minor * s.late_cancellation_fee_bps) / 10000;
  end if;

  perform set_config('app.transition_reason', coalesce(p_reason, ''), true);
  update public.bookings set
    status = p_to,
    confirmed_at = case when p_to = 'CONFIRMED' then now() else confirmed_at end,
    picked_up_at = case when p_to = 'ACTIVE' then now() else picked_up_at end,
    returned_at = case when p_to = 'RETURNED' then now() else returned_at end,
    cancelled_at = case when p_to = 'CANCELLED' then now() else cancelled_at end,
    cancellation_reason = case when p_to = 'CANCELLED' then p_reason else cancellation_reason end,
    cancellation_fee_minor = case when p_to = 'CANCELLED' then v_fee else cancellation_fee_minor end
  where id = b.id
  returning * into b;

  return jsonb_build_object('id', b.id, 'status', b.status, 'version', b.version,
                            'cancellation_fee_minor', v_fee,
                            'refundable_minor', greatest(b.amount_paid_minor - b.amount_refunded_minor - v_fee, 0));
end $$;

-- ---------------------------------------------------------------------
-- Assign / substitute a vehicle (class bookings, upgrades, breakdowns).
-- ---------------------------------------------------------------------
create or replace function public.assign_booking_vehicle(p_booking uuid, p_vehicle uuid, p_reason text default 'CLASS_ASSIGNMENT')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v public.vehicles;
  v_booked_class public.vehicle_classes;
  v_new_class public.vehicle_classes;
  v_range tstzrange;
  v_block uuid;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001'; end if;
  if not app.is_service_call() and not app.has_permission(b.tenant_id, 'bookings.write') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if b.status not in ('PENDING_APPROVAL', 'CONFIRMED', 'CHECK_IN_PENDING', 'READY_FOR_PICKUP', 'PENDING_PAYMENT') then
    raise exception 'BOOKING_NOT_ASSIGNABLE' using errcode = 'P0001';
  end if;
  select * into v from public.vehicles where id = p_vehicle and tenant_id = b.tenant_id;
  if not found or v.status in ('INACTIVE', 'SOLD', 'DAMAGED') then raise exception 'VEHICLE_NOT_BOOKABLE' using errcode = 'P0001'; end if;

  -- Substitution policy: same class, a higher-ranked class, or same equivalence group.
  if b.vehicle_class_id is not null then
    select * into v_booked_class from public.vehicle_classes where id = b.vehicle_class_id;
    select c.* into v_new_class from public.vehicle_classes c join public.vehicle_class_members m on m.class_id = c.id
     where m.vehicle_id = p_vehicle;
    if v_new_class.id is null
       or not (v_new_class.id = v_booked_class.id
               or v_new_class.rank > v_booked_class.rank
               or (v_booked_class.equivalence_group is not null and v_new_class.equivalence_group = v_booked_class.equivalence_group)) then
      raise exception 'SUBSTITUTION_NOT_ALLOWED' using errcode = 'P0001';
    end if;
  end if;

  v_range := app.occupancy_range(b.tenant_id, b.starts_at, b.ends_at);
  update public.booking_vehicle_assignments set unassigned_at = now() where booking_id = b.id and unassigned_at is null;
  update public.vehicle_availability_blocks set released_at = now() where booking_id = b.id and released_at is null;
  begin
    insert into public.vehicle_availability_blocks (tenant_id, vehicle_id, kind, period, booking_id, created_by)
    values (b.tenant_id, p_vehicle, 'BOOKING', v_range, b.id, auth.uid()) returning id into v_block;
  exception when exclusion_violation then
    raise exception 'VEHICLE_UNAVAILABLE' using errcode = 'P0001';
  end;
  insert into public.booking_vehicle_assignments (tenant_id, booking_id, vehicle_id, block_id, reason, assigned_by)
  values (b.tenant_id, b.id, p_vehicle, v_block,
          case when p_reason in ('CLASS_ASSIGNMENT', 'SUBSTITUTION', 'UPGRADE') then p_reason else 'SUBSTITUTION' end, auth.uid());
  update public.bookings set vehicle_id = p_vehicle where id = b.id;
  return jsonb_build_object('booking_id', b.id, 'vehicle_id', p_vehicle);
end $$;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
revoke all on function public.create_booking(jsonb), public.record_booking_payment(uuid, bigint, uuid),
  public.release_expired_holds(uuid) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb), public.record_booking_payment(uuid, bigint, uuid),
  public.release_expired_holds(uuid) to service_role;

revoke all on function public.create_tenant(text, text, text, char, char, text, text), public.accept_invitation(text),
  public.transition_booking(uuid, public.booking_status, text, integer), public.assign_booking_vehicle(uuid, uuid, text)
  from public, anon;
grant execute on function public.create_tenant(text, text, text, char, char, text, text), public.accept_invitation(text),
  public.transition_booking(uuid, public.booking_status, text, integer), public.assign_booking_vehicle(uuid, uuid, text)
  to authenticated, service_role;

grant execute on function public.resolve_tenant(text, text, text), public.search_available_vehicles(uuid, timestamptz, timestamptz, uuid, public.vehicle_category, integer, integer),
  public.is_vehicle_available(uuid, timestamptz, timestamptz) to anon, authenticated, service_role;

revoke all on function app.setting(text), app.user_has_permission(uuid, uuid, text), app.buffer_minutes(uuid),
  app.vehicle_is_free(uuid, tstzrange, uuid), app.class_spare_capacity(uuid, tstzrange),
  app.validate_rental_window(uuid, timestamptz, timestamptz, boolean), app.occupancy_range(uuid, timestamptz, timestamptz)
  from public;
grant execute on function app.has_permission(uuid, text), app.user_has_permission(uuid, uuid, text),
  app.occupancy_range(uuid, timestamptz, timestamptz), app.buffer_minutes(uuid), app.vehicle_is_free(uuid, tstzrange, uuid)
  to authenticated, anon, service_role;
grant execute on function app.setting(text), app.class_spare_capacity(uuid, tstzrange),
  app.validate_rental_window(uuid, timestamptz, timestamptz, boolean) to service_role;
