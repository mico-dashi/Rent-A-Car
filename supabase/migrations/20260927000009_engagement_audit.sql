-- =====================================================================
-- 0009 NOTIFICATIONS, REVIEWS, MESSAGING, PRIVACY, AUDIT
-- =====================================================================

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade, -- null = platform default
  event text not null check (event in (
    'booking.confirmed', 'booking.cancelled', 'payment.succeeded', 'payment.failed', 'pickup.reminder',
    'return.reminder', 'rental.overdue', 'deposit.updated', 'vehicle.insurance_expiring',
    'vehicle.registration_expiring', 'maintenance.due', 'staff.invited', 'message.received')),
  channel public.notification_channel not null,
  language text not null references public.languages(code),
  subject text,
  body text not null,               -- Mustache-style {{variables}}, rendered server-side & escaped
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index notification_templates_platform on public.notification_templates(event, channel, language) where tenant_id is null;
create unique index notification_templates_tenant on public.notification_templates(tenant_id, event, channel, language) where tenant_id is not null;
create trigger set_updated_at before update on public.notification_templates for each row execute function app.set_updated_at();

create table public.notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel public.notification_channel not null,
  event text not null,
  enabled boolean not null,
  primary key (user_id, tenant_id, channel, event)
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  app_variant text not null default 'universal',
  last_seen_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  recipient_address text,           -- email/phone for non-account recipients
  event text not null,
  channel public.notification_channel not null,
  title text,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'READ')),
  dedupe_key text,                  -- prevents duplicate reminders
  provider_message_id text,
  error text,
  attempts integer not null default 0,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (dedupe_key, channel),
  check (user_id is not null or recipient_address is not null)
);
create index notifications_user_idx on public.notifications(user_id, created_at desc) where channel = 'IN_APP';
create index notifications_queue_idx on public.notifications(send_after) where status = 'QUEUED';

-- ---------------- Reviews ----------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null,
  vehicle_id uuid not null,
  customer_id uuid not null,
  author_user_id uuid not null references auth.users(id),
  rating_car smallint not null check (rating_car between 1 and 5),
  rating_cleanliness smallint not null check (rating_cleanliness between 1 and 5),
  rating_service smallint not null check (rating_service between 1 and 5),
  rating_pickup smallint not null check (rating_pickup between 1 and 5),
  rating_value smallint not null check (rating_value between 1 and 5),
  rating_overall numeric(3,2) generated always as
    ((rating_car + rating_cleanliness + rating_service + rating_pickup + rating_value) / 5.0) stored,
  body text check (length(body) <= 4000),
  is_published boolean not null default true,
  hidden_reason text,               -- moderation hides; it never edits customer text
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  foreign key (tenant_id, vehicle_id) references public.vehicles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade
);
create index reviews_vehicle_idx on public.reviews(vehicle_id, created_at desc) where is_published;
select app.install_row_triggers('public.reviews');

-- Verified reviews only: booking must be COMPLETED and belong to the author.
create or replace function app.guard_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  if tg_op = 'UPDATE' then
    if new.body is distinct from old.body and auth.uid() is distinct from old.author_user_id then
      raise exception 'Only the author may edit review text' using errcode = '42501';
    end if;
    return new;
  end if;
  select * into v_booking from public.bookings where id = new.booking_id;
  if v_booking.status <> 'COMPLETED' then
    raise exception 'Only completed bookings can be reviewed' using errcode = 'P0001';
  end if;
  if v_booking.customer_id <> new.customer_id or v_booking.vehicle_id <> new.vehicle_id
     or v_booking.tenant_id <> new.tenant_id then
    raise exception 'Review does not match booking' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers c where c.id = new.customer_id and c.user_id = new.author_user_id) then
    raise exception 'Reviewer is not the booking customer' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_review before insert or update on public.reviews
  for each row execute function app.guard_review();

create or replace function app.refresh_vehicle_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_vehicle uuid := coalesce(new.vehicle_id, old.vehicle_id);
begin
  update public.vehicles v set
    rating_avg = coalesce((select round(avg(r.rating_overall), 2) from public.reviews r where r.vehicle_id = v_vehicle and r.is_published), 0),
    rating_count = (select count(*) from public.reviews r where r.vehicle_id = v_vehicle and r.is_published)
  where v.id = v_vehicle;
  return null;
end $$;
create trigger refresh_vehicle_rating after insert or update or delete on public.reviews
  for each row execute function app.refresh_vehicle_rating();

create table public.review_replies (
  review_id uuid primary key references public.reviews(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select app.install_row_triggers('public.review_replies');

-- ---------------- Messaging ----------------
create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  booking_id uuid,
  subject text,
  kind text not null default 'GENERAL' check (kind in ('GENERAL', 'BOOKING', 'SUPPORT')),
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete set null (booking_id)
);
create index message_threads_tenant_idx on public.message_threads(tenant_id, last_message_at desc);
select app.install_row_triggers('public.message_threads');

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  thread_id uuid not null,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_kind text not null check (sender_kind in ('CUSTOMER', 'STAFF', 'SYSTEM')),
  body text check (length(body) <= 5000),
  attachment_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (tenant_id, thread_id) references public.message_threads(tenant_id, id) on delete cascade,
  check (body is not null or cardinality(attachment_paths) > 0)
);
create index messages_thread_idx on public.messages(thread_id, created_at);

create or replace function app.touch_thread() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.message_threads set last_message_at = new.created_at where id = new.thread_id;
  return null;
end $$;
create trigger touch_thread after insert on public.messages for each row execute function app.touch_thread();

-- ---------------- Privacy requests ----------------
create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('EXPORT', 'DELETE')),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED')),
  result_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.privacy_requests for each row execute function app.set_updated_at();

-- ---------------- Audit log ----------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_id uuid,
  actor_kind text not null default 'USER' check (actor_kind in ('USER', 'SYSTEM', 'SERVICE', 'PLATFORM_ADMIN')),
  action text not null,             -- e.g. bookings.update, vehicles.status
  resource_type text not null,
  resource_id text,
  before_state jsonb,
  after_state jsonb,
  ip_address inet,
  user_agent text,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_idx on public.audit_logs(tenant_id, created_at desc);
create index audit_logs_resource_idx on public.audit_logs(resource_type, resource_id);

-- Immutable: no one (except a superuser performing retention) may update/delete.
create or replace function app.audit_immutable() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.audit_retention_purge', true), '') = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;
create trigger audit_immutable before update or delete on public.audit_logs
  for each row execute function app.audit_immutable();

-- Generic row-change auditor. Server code can set request metadata via
-- set_config('app.request_ip', ..., true) / 'app.user_agent' / 'app.request_id'.
create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_tenant uuid;
  v_ip inet;
  v_key text;
begin
  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;
  -- PII tables: record which columns changed, never the values themselves.
  if tg_nargs > 0 and tg_argv[0] = 'redact' then
    v_tenant := coalesce((v_after ->> 'tenant_id')::uuid, (v_before ->> 'tenant_id')::uuid);
    for v_key in select jsonb_object_keys(coalesce(v_after, v_before)) loop
      if v_key not in ('id', 'tenant_id', 'customer_id', 'status', 'verification_status', 'identity_status', 'is_restricted')
         and (v_before -> v_key) is not distinct from (v_after -> v_key) then
        v_before := v_before - v_key;
        v_after := v_after - v_key;
      elsif v_key not in ('id', 'tenant_id', 'customer_id', 'status', 'verification_status', 'identity_status', 'is_restricted') then
        v_before := case when v_before is null then null else jsonb_set(v_before, array[v_key], '"[redacted]"') end;
        v_after := case when v_after is null then null else jsonb_set(v_after, array[v_key], '"[redacted]"') end;
      end if;
    end loop;
  end if;
  v_tenant := coalesce((v_after ->> 'tenant_id')::uuid, (v_before ->> 'tenant_id')::uuid);
  if tg_table_name = 'tenants' then
    v_tenant := coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid);
  end if;
  begin
    v_ip := nullif(current_setting('app.request_ip', true), '')::inet;
  exception when others then
    v_ip := null;
  end;
  insert into public.audit_logs (tenant_id, actor_id, actor_kind, action, resource_type, resource_id,
                                 before_state, after_state, ip_address, user_agent, request_id)
  values (
    v_tenant,
    auth.uid(),
    case when auth.uid() is null then 'SERVICE'
         when app.is_platform_admin() then 'PLATFORM_ADMIN' else 'USER' end,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'tenant_id', v_before ->> 'tenant_id'),
    v_before,
    v_after,
    v_ip,
    nullif(current_setting('app.user_agent', true), ''),
    nullif(current_setting('app.request_id', true), '')
  );
  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'tenant_settings', 'tenant_branding', 'tenant_domains', 'tenant_subscriptions', 'feature_flags',
    'memberships', 'membership_permission_overrides', 'platform_admins', 'branches', 'vehicles',
    'vehicle_classes', 'bookings', 'booking_vehicle_assignments', 'booking_price_lines', 'pricing_rules',
    'seasonal_rates', 'discount_codes', 'tax_rules', 'extras', 'payments', 'refunds', 'security_deposits',
    'customer_restrictions', 'vehicle_damages', 'damage_ai_assessments', 'rental_agreements',
    'maintenance_records', 'subscription_plans'
  ] loop
    execute format('create trigger audit_row_change after insert or update or delete on public.%I
                    for each row execute function app.audit_row_change()', t);
  end loop;
  foreach t in array array['customers', 'driver_licenses', 'customer_documents', 'signatures'] loop
    execute format('create trigger audit_row_change after insert or update or delete on public.%I
                    for each row execute function app.audit_row_change(''redact'')', t);
  end loop;
end $$;
