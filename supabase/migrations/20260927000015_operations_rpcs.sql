-- =====================================================================
-- 0015 OPERATIONS RPCs: staff invitations, plan limits, feature flags,
-- booking modification, agreements/signatures, notification queueing,
-- housekeeping, analytics, platform overview.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Feature flags: tenant override > platform default > plan feature.
-- ---------------------------------------------------------------------
create or replace function app.feature_enabled(p_tenant uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select f.enabled from public.feature_flags f where f.key = p_key and f.tenant_id = p_tenant),
    (select (p.features ->> p_key)::boolean from public.tenant_subscriptions s
       join public.subscription_plans p on p.id = s.plan_id
      where s.tenant_id = p_tenant and s.status in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'LIFETIME')
        and p.features ? p_key),
    (select f.enabled from public.feature_flags f where f.key = p_key and f.tenant_id is null),
    false)
$$;

create or replace function public.tenant_features(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, app.feature_enabled(p_tenant, k)), '{}'::jsonb)
  from (
    select distinct key as k from public.feature_flags
    union select jsonb_object_keys(features) from public.subscription_plans
  ) keys
  where app.is_member(p_tenant) or app.is_platform_admin()
$$;

-- ---------------------------------------------------------------------
-- Plan limits (vehicles, branches, staff). Null limit = unlimited.
-- ---------------------------------------------------------------------
create or replace function app.enforce_plan_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_count integer;
begin
  select case tg_table_name
           when 'vehicles' then p.max_vehicles
           when 'branches' then p.max_branches
           when 'memberships' then p.max_staff end
    into v_limit
    from public.tenant_subscriptions s join public.subscription_plans p on p.id = s.plan_id
   where s.tenant_id = new.tenant_id and s.status in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'LIFETIME');
  if v_limit is null then return new; end if;
  execute format('select count(*) from public.%I where tenant_id = $1 %s', tg_table_name,
                 case tg_table_name
                   when 'vehicles' then 'and status <> ''SOLD'''
                   when 'memberships' then 'and status <> ''SUSPENDED'''
                   else 'and is_active' end)
    into v_count using new.tenant_id;
  if v_count >= v_limit then
    raise exception 'PLAN_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger enforce_plan_limit before insert on public.vehicles for each row execute function app.enforce_plan_limit();
create trigger enforce_plan_limit before insert on public.branches for each row execute function app.enforce_plan_limit();
create trigger enforce_plan_limit before insert on public.memberships for each row
  when (new.role <> 'TENANT_OWNER') execute function app.enforce_plan_limit();

-- ---------------------------------------------------------------------
-- Staff invitations. Returns the raw token ONCE (to be emailed); only its
-- hash is stored. Rank rules mirror app.guard_membership_write.
-- ---------------------------------------------------------------------
create or replace function public.invite_staff(p_tenant uuid, p_email text, p_role public.role_key, p_branch_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_my_rank smallint;
  v_target_rank smallint;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
begin
  if not app.has_permission(p_tenant, 'staff.manage') then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  select r.rank into v_my_rank from public.memberships m join public.roles r on r.key = m.role
   where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'ACTIVE';
  select rank into v_target_rank from public.roles where key = p_role;
  if p_role = 'TENANT_OWNER' or (v_target_rank <= v_my_rank and v_my_rank <> 10) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_branch_ids) b where not exists (select 1 from public.branches x where x.id = b and x.tenant_id = p_tenant)) then
    raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
             where m.tenant_id = p_tenant and lower(u.email) = lower(p_email)) then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;
  insert into public.memberships (tenant_id, invited_email, role, status, branch_ids, invite_token_hash, invite_expires_at, invited_by)
  values (p_tenant, lower(p_email), p_role, 'INVITED', p_branch_ids, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days', auth.uid())
  on conflict (tenant_id, invited_email) where user_id is null do update
    set role = excluded.role, branch_ids = excluded.branch_ids, invite_token_hash = excluded.invite_token_hash,
        invite_expires_at = excluded.invite_expires_at, invited_by = excluded.invited_by
  returning id into v_id;
  return jsonb_build_object('membership_id', v_id, 'token', v_token);
end $$;

-- Suspend / reactivate staff (owner membership untouchable; rank rules apply).
create or replace function public.set_membership_status(p_membership uuid, p_status public.membership_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships;
  v_my_rank smallint;
  v_target_rank smallint;
begin
  select * into m from public.memberships where id = p_membership;
  if not found or not app.has_permission(m.tenant_id, 'staff.manage') then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if m.role = 'TENANT_OWNER' or m.user_id = auth.uid() or p_status = 'INVITED' then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  select r.rank into v_my_rank from public.memberships x join public.roles r on r.key = x.role
   where x.tenant_id = m.tenant_id and x.user_id = auth.uid() and x.status = 'ACTIVE';
  select rank into v_target_rank from public.roles where key = m.role;
  if v_target_rank <= v_my_rank and v_my_rank <> 10 then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  update public.memberships set status = p_status where id = p_membership;
end $$;

-- ---------------------------------------------------------------------
-- Booking modification (dates / return branch). SERVICE ROLE: the server
-- re-prices with @rental/domain and passes the new snapshot.
-- ---------------------------------------------------------------------
create or replace function public.modify_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_actor uuid := (p ->> 'actor_user_id')::uuid;
  v_start timestamptz := (p ->> 'starts_at')::timestamptz;
  v_end timestamptz := (p ->> 'ends_at')::timestamptz;
  v_is_staff boolean;
  v_lines_total bigint;
  v_line jsonb;
  v_i integer := 0;
begin
  select * into b from public.bookings where id = (p ->> 'booking_id')::uuid for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001'; end if;
  if (p ->> 'expected_version') is not null and b.version <> (p ->> 'expected_version')::int then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  v_is_staff := app.user_has_permission(v_actor, b.tenant_id, 'bookings.write');
  if not v_is_staff and not exists (select 1 from public.customers c where c.id = b.customer_id and c.user_id = v_actor) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if b.status not in ('PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'CHECK_IN_PENDING', 'READY_FOR_PICKUP') then
    raise exception 'BOOKING_NOT_MODIFIABLE' using errcode = 'P0001';
  end if;
  if not v_is_staff and b.starts_at <= now() + make_interval(hours => (select free_cancellation_hours from public.tenant_settings where tenant_id = b.tenant_id)) then
    raise exception 'BOOKING_NOT_MODIFIABLE' using errcode = 'P0001';
  end if;
  perform app.validate_rental_window(b.tenant_id, v_start, v_end, v_is_staff);
  select coalesce(sum((l ->> 'amount_minor')::bigint), 0) into v_lines_total from jsonb_array_elements(p -> 'lines') l;
  if v_lines_total <> (p ->> 'total_minor')::bigint then raise exception 'PRICE_LINES_MISMATCH' using errcode = 'P0001'; end if;

  -- Move the occupancy block; the exclusion constraint validates the new window.
  begin
    update public.vehicle_availability_blocks set period = app.occupancy_range(b.tenant_id, v_start, v_end)
     where booking_id = b.id and released_at is null;
  exception when exclusion_violation then
    raise exception 'VEHICLE_UNAVAILABLE' using errcode = 'P0001';
  end;
  if b.vehicle_class_id is not null and b.vehicle_id is null
     and app.class_spare_capacity(b.vehicle_class_id, app.occupancy_range(b.tenant_id, v_start, v_end)) < 0 then
    raise exception 'CLASS_SOLD_OUT' using errcode = 'P0001';
  end if;

  delete from public.booking_price_lines where booking_id = b.id and not is_post_rental;
  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    insert into public.booking_price_lines (tenant_id, booking_id, kind, label, label_params, quantity, unit_amount_minor, amount_minor, is_taxable, source_rule_id, sort_order)
    values (b.tenant_id, b.id, (v_line ->> 'kind')::public.price_line_kind, v_line ->> 'label', coalesce(v_line -> 'label_params', '{}'::jsonb), coalesce((v_line ->> 'quantity')::numeric, 1),
            (v_line ->> 'unit_amount_minor')::bigint, (v_line ->> 'amount_minor')::bigint, coalesce((v_line ->> 'is_taxable')::boolean, true),
            (v_line ->> 'source_rule_id')::uuid, v_i);
    v_i := v_i + 1;
  end loop;

  perform set_config('app.allow_reprice', 'on', true);
  perform set_config('app.transition_reason', 'MODIFIED', true);
  update public.bookings set
    starts_at = v_start, ends_at = v_end,
    return_branch_id = coalesce((p ->> 'return_branch_id')::uuid, return_branch_id),
    rental_minor = (p ->> 'rental_minor')::bigint, extras_minor = (p ->> 'extras_minor')::bigint, fees_minor = (p ->> 'fees_minor')::bigint,
    discount_minor = (p ->> 'discount_minor')::bigint, tax_minor = (p ->> 'tax_minor')::bigint, total_minor = (p ->> 'total_minor')::bigint,
    deposit_minor = (p ->> 'deposit_minor')::bigint, due_now_minor = least((p ->> 'due_now_minor')::bigint, (p ->> 'total_minor')::bigint),
    pricing_snapshot = coalesce(p -> 'pricing_snapshot', pricing_snapshot) || jsonb_build_object('modifiedAt', now(), 'previousTotalMinor', b.total_minor),
    payment_status = case when b.amount_paid_minor >= (p ->> 'total_minor')::bigint and b.amount_paid_minor > 0 then 'PAID'::public.payment_status
                          when b.amount_paid_minor > 0 then 'PARTIALLY_PAID'::public.payment_status else b.payment_status end
  where id = b.id returning * into b;
  perform set_config('app.allow_reprice', '', true);
  return jsonb_build_object('id', b.id, 'version', b.version, 'total_minor', b.total_minor,
                            'balance_minor', b.total_minor - (b.amount_paid_minor - b.amount_refunded_minor));
end $$;

-- Post-rental charges proposed by the engine and CONFIRMED by staff.
create or replace function public.add_post_rental_charges(p_booking uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_line jsonb;
  v_add bigint := 0;
  v_i integer := 1000;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001'; end if;
  if not app.is_service_call() and not app.has_permission(b.tenant_id, 'payments.charge') then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if b.status not in ('ACTIVE', 'RETURN_DUE', 'RETURNED', 'DISPUTED') then raise exception 'BOOKING_NOT_MODIFIABLE' using errcode = 'P0001'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ->> 'kind') not in ('MILEAGE', 'FUEL', 'LATE_RETURN', 'DAMAGE', 'OTHER') or (v_line ->> 'amount_minor')::bigint < 0 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
    end if;
    insert into public.booking_price_lines (tenant_id, booking_id, kind, label, label_params, quantity, unit_amount_minor, amount_minor, is_taxable, is_post_rental, sort_order)
    values (b.tenant_id, b.id, (v_line ->> 'kind')::public.price_line_kind, v_line ->> 'label', coalesce(v_line -> 'label_params', '{}'::jsonb), coalesce((v_line ->> 'quantity')::numeric, 1),
            (v_line ->> 'unit_amount_minor')::bigint, (v_line ->> 'amount_minor')::bigint, true, true, v_i);
    v_add := v_add + (v_line ->> 'amount_minor')::bigint;
    v_i := v_i + 1;
  end loop;
  perform set_config('app.allow_reprice', 'on', true);
  update public.bookings set fees_minor = fees_minor + v_add, total_minor = total_minor + v_add,
    pricing_snapshot = pricing_snapshot || jsonb_build_object('postRentalChargesMinor', coalesce((pricing_snapshot ->> 'postRentalChargesMinor')::bigint, 0) + v_add,
                                                               'postRentalChargedBy', auth.uid())
   where id = b.id returning * into b;
  perform set_config('app.allow_reprice', '', true);
  return jsonb_build_object('added_minor', v_add, 'total_minor', b.total_minor, 'balance_minor', b.total_minor - (b.amount_paid_minor - b.amount_refunded_minor));
end $$;

-- ---------------------------------------------------------------------
-- Agreements: signature bookkeeping.
-- ---------------------------------------------------------------------
create or replace function app.after_signature() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_has_customer boolean;
  v_has_employee boolean;
begin
  if new.agreement_id is null then return null; end if;
  select bool_or(signer_role = 'CUSTOMER'), bool_or(signer_role = 'EMPLOYEE') into v_has_customer, v_has_employee
    from public.signatures where agreement_id = new.agreement_id;
  update public.rental_agreements set
    status = case when v_has_customer and v_has_employee then 'FULLY_SIGNED' when v_has_customer then 'CUSTOMER_SIGNED' else status end,
    fully_signed_at = case when v_has_customer and v_has_employee then now() else fully_signed_at end
  where id = new.agreement_id and status <> 'VOID';
  return null;
end $$;
create trigger after_signature after insert on public.signatures for each row execute function app.after_signature();

-- Signatures must match the agreement content hash they claim to sign.
create or replace function app.guard_signature() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.agreement_id is not null and not exists (
    select 1 from public.rental_agreements a where a.id = new.agreement_id and a.content_sha256 = new.signed_content_sha256 and a.status <> 'VOID') then
    raise exception 'SIGNATURE_CONTENT_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_signature before insert on public.signatures for each row execute function app.guard_signature();

-- ---------------------------------------------------------------------
-- Notification queue. Rendering happens in the dispatcher (templates per
-- tenant/language); rows carry event + data only.
-- ---------------------------------------------------------------------
alter table public.notifications alter column body set default '';

create or replace function app.enqueue(p_tenant uuid, p_user uuid, p_address text, p_event text, p_channels public.notification_channel[],
                                       p_data jsonb, p_dedupe text, p_send_after timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.notification_channel;
begin
  foreach c in array p_channels loop
    if p_user is not null and exists (select 1 from public.notification_preferences np
        where np.user_id = p_user and np.tenant_id = p_tenant and np.channel = c and np.event = p_event and not np.enabled) then
      continue;
    end if;
    if c <> 'EMAIL' and p_user is null then continue; end if;
    insert into public.notifications (tenant_id, user_id, recipient_address, event, channel, data, dedupe_key, send_after)
    values (p_tenant, p_user, case when c = 'EMAIL' then p_address end, p_event, c, p_data, p_dedupe, p_send_after)
    on conflict (dedupe_key, channel) do nothing;
  end loop;
end $$;

create or replace function app.booking_notification_data(b public.bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'bookingId', b.id, 'reference', b.reference, 'firstName', c.first_name, 'vehicle', coalesce(v.make || ' ' || v.model, ''),
    'pickupAt', b.starts_at, 'returnAt', b.ends_at, 'branch', br.name, 'timezone', br.timezone, 'totalMinor', b.total_minor, 'currency', b.currency)
  from public.customers c
  left join public.vehicles v on v.id = b.vehicle_id
  join public.branches br on br.id = b.pickup_branch_id
  where c.id = b.customer_id
$$;

create or replace function app.notify_booking_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
begin
  if new.status is not distinct from old.status then return null; end if;
  select * into c from public.customers where id = new.customer_id;
  if new.status in ('CONFIRMED', 'CANCELLED') then
    perform app.enqueue(new.tenant_id, c.user_id, c.email,
      case new.status when 'CONFIRMED' then 'booking.confirmed' else 'booking.cancelled' end,
      array['IN_APP', 'EMAIL', 'PUSH']::public.notification_channel[], app.booking_notification_data(new),
      'booking:' || new.id || ':' || lower(new.status::text));
    if new.status = 'CONFIRMED' then
      perform app.enqueue(new.tenant_id, c.user_id, c.email, 'pickup.reminder', array['PUSH', 'EMAIL']::public.notification_channel[],
        app.booking_notification_data(new), 'booking:' || new.id || ':pickup-reminder', new.starts_at - interval '24 hours');
    end if;
  elsif new.status = 'ACTIVE' then
    perform app.enqueue(new.tenant_id, c.user_id, c.email, 'return.reminder', array['PUSH']::public.notification_channel[],
      app.booking_notification_data(new), 'booking:' || new.id || ':return-reminder', new.ends_at - interval '3 hours');
  end if;
  return null;
end $$;
create trigger notify_booking_status after update of status on public.bookings for each row execute function app.notify_booking_status();

create or replace function app.notify_payment_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  b public.bookings;
begin
  if new.status is not distinct from old.status or new.status not in ('SUCCEEDED', 'FAILED') or new.booking_id is null then return null; end if;
  select * into b from public.bookings where id = new.booking_id;
  select * into c from public.customers where id = b.customer_id;
  perform app.enqueue(new.tenant_id, c.user_id, c.email, case new.status when 'SUCCEEDED' then 'payment.succeeded' else 'payment.failed' end,
    array['IN_APP', 'EMAIL']::public.notification_channel[], app.booking_notification_data(b) || jsonb_build_object('amountMinor', new.amount_minor),
    'payment:' || new.id || ':' || lower(new.status));
  return null;
end $$;
create trigger notify_payment_status after update of status on public.payments for each row execute function app.notify_payment_status();

create or replace function app.notify_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.message_threads;
  c public.customers;
begin
  select * into t from public.message_threads where id = new.thread_id;
  if new.sender_kind = 'STAFF' or new.sender_kind = 'SYSTEM' then
    select * into c from public.customers where id = t.customer_id;
    perform app.enqueue(new.tenant_id, c.user_id, c.email, 'message.received', array['IN_APP', 'PUSH']::public.notification_channel[],
      jsonb_build_object('threadId', t.id, 'preview', left(coalesce(new.body, ''), 120)), 'message:' || new.id);
  end if;
  return null;
end $$;
create trigger notify_message after insert on public.messages for each row execute function app.notify_message();

-- Staff can read in-app notifications addressed to themselves (already own_select); dispatcher is service role.

-- ---------------------------------------------------------------------
-- Housekeeping (cron): overdue rentals, document expiry, maintenance due.
-- ---------------------------------------------------------------------
create or replace function public.run_housekeeping() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  bk public.bookings;
  v_overdue integer := 0;
  v_docs integer := 0;
  v_maint integer := 0;
  v_holds integer;
begin
  v_holds := public.release_expired_holds(null);

  for bk in select b.* from public.bookings b where b.status = 'ACTIVE' and b.ends_at < now() for update skip locked loop
    perform set_config('app.transition_reason', 'OVERDUE', true);
    update public.bookings set status = 'RETURN_DUE' where id = bk.id;
    perform app.enqueue(bk.tenant_id, (select user_id from public.customers where id = bk.customer_id),
      (select email from public.customers where id = bk.customer_id), 'rental.overdue', array['IN_APP', 'PUSH', 'EMAIL']::public.notification_channel[],
      app.booking_notification_data(bk), 'booking:' || bk.id || ':overdue');
    v_overdue := v_overdue + 1;
  end loop;

  -- Staff alerts: to every active member holding the relevant permission.
  for r in
    select d.id, d.tenant_id, d.kind, d.expires_on, v.make || ' ' || v.model || ' (' || v.registration_plate || ')' as vehicle
    from public.vehicle_documents d join public.vehicles v on v.id = d.vehicle_id
    where d.kind in ('INSURANCE', 'REGISTRATION', 'INSPECTION') and d.expires_on between current_date and current_date + 30
  loop
    perform app.enqueue(r.tenant_id, m.user_id, null,
      case r.kind when 'INSURANCE' then 'vehicle.insurance_expiring' else 'vehicle.registration_expiring' end,
      array['IN_APP']::public.notification_channel[], jsonb_build_object('vehicle', r.vehicle, 'expiresOn', r.expires_on, 'documentId', r.id),
      'doc:' || r.id || ':' || r.expires_on || ':' || m.user_id)
    from public.memberships m where m.tenant_id = r.tenant_id and m.status = 'ACTIVE' and app.user_has_permission(m.user_id, r.tenant_id, 'vehicles.write');
    v_docs := v_docs + 1;
  end loop;

  for r in
    select mr.id, mr.tenant_id, mr.scheduled_start, v.make || ' ' || v.model as vehicle
    from public.maintenance_records mr join public.vehicles v on v.id = mr.vehicle_id
    where mr.status = 'SCHEDULED' and mr.scheduled_start between now() and now() + interval '2 days'
  loop
    perform app.enqueue(r.tenant_id, m.user_id, null, 'maintenance.due', array['IN_APP']::public.notification_channel[],
      jsonb_build_object('vehicle', r.vehicle, 'scheduledStart', r.scheduled_start), 'maint:' || r.id || ':' || m.user_id)
    from public.memberships m where m.tenant_id = r.tenant_id and m.status = 'ACTIVE' and app.user_has_permission(m.user_id, r.tenant_id, 'maintenance.manage');
    v_maint := v_maint + 1;
  end loop;

  delete from public.idempotency_keys where expires_at < now();
  return jsonb_build_object('released_holds', v_holds, 'overdue', v_overdue, 'expiring_documents', v_docs, 'maintenance_due', v_maint);
end $$;

-- ---------------------------------------------------------------------
-- Tenant analytics. Revenue = booking totals (by pickup date) of bookings
-- that were not cancelled/no-show, plus cancellation fees retained.
-- ---------------------------------------------------------------------
create or replace function public.tenant_dashboard(p_tenant uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_result jsonb;
  v_fleet integer;
  v_window_hours numeric;
begin
  if not app.has_permission(p_tenant, 'reports.read') and not app.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_to < p_from or p_to - p_from > 731 then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  select timezone into tz from public.tenant_settings where tenant_id = p_tenant;
  v_from := (p_from::timestamp at time zone tz);
  v_to := ((p_to + 1)::timestamp at time zone tz);
  v_today_start := (date_trunc('day', now() at time zone tz) at time zone tz);
  v_today_end := v_today_start + interval '1 day';
  select count(*) into v_fleet from public.vehicles where tenant_id = p_tenant and status not in ('SOLD', 'INACTIVE');
  v_window_hours := extract(epoch from (v_to - v_from)) / 3600;

  with bk as (
    select b.*, extract(epoch from (b.ends_at - b.starts_at)) / 86400 as days,
           case when b.status in ('CANCELLED', 'NO_SHOW') then coalesce(b.cancellation_fee_minor, 0) else b.total_minor end as revenue
    from public.bookings b
    where b.tenant_id = p_tenant and b.starts_at >= v_from and b.starts_at < v_to and b.status not in ('DRAFT', 'QUOTE')
  ),
  live as (select * from bk where status not in ('CANCELLED', 'NO_SHOW', 'PENDING_PAYMENT')),
  occ as (
    select blk.vehicle_id,
           sum(extract(epoch from (least(upper(blk.period), v_to) - greatest(lower(blk.period), v_from))) / 3600) as hours
    from public.vehicle_availability_blocks blk
    join public.bookings b2 on b2.id = blk.booking_id and b2.status not in ('CANCELLED', 'NO_SHOW', 'PENDING_PAYMENT')
    where blk.tenant_id = p_tenant and blk.kind = 'BOOKING' and blk.period && tstzrange(v_from, v_to)
    group by blk.vehicle_id
  ),
  series as (
    select d::date as day,
           coalesce(sum(bk.revenue), 0)::bigint as revenue_minor,
           count(bk.id) filter (where bk.status not in ('CANCELLED', 'NO_SHOW'))::int as bookings
    from generate_series(p_from, p_to, interval '1 day') d
    left join bk on (bk.starts_at at time zone tz)::date = d::date
    group by d order by d
  )
  select jsonb_build_object(
    'currency', (select base_currency from public.tenants where id = p_tenant),
    'today', jsonb_build_object(
      'bookingsCreated', (select count(*) from public.bookings where tenant_id = p_tenant and created_at >= v_today_start and created_at < v_today_end and status not in ('DRAFT', 'QUOTE')),
      'pickups', (select count(*) from public.bookings where tenant_id = p_tenant and starts_at >= v_today_start and starts_at < v_today_end
                  and status in ('CONFIRMED', 'CHECK_IN_PENDING', 'READY_FOR_PICKUP', 'ACTIVE')),
      'returns', (select count(*) from public.bookings where tenant_id = p_tenant and ends_at >= v_today_start and ends_at < v_today_end
                  and status in ('ACTIVE', 'RETURN_DUE', 'RETURNED', 'COMPLETED')),
      'activeRentals', (select count(*) from public.bookings where tenant_id = p_tenant and status in ('ACTIVE', 'RETURN_DUE')),
      'overdue', (select count(*) from public.bookings where tenant_id = p_tenant and status = 'RETURN_DUE'),
      'availableFleet', (select count(*) from public.vehicles v where v.tenant_id = p_tenant and v.status = 'AVAILABLE'
                         and app.vehicle_is_free(v.id, tstzrange(now(), now() + interval '1 minute'))),
      'fleetSize', v_fleet),
    'period', jsonb_build_object(
      'revenueMinor', coalesce((select sum(revenue) from bk), 0),
      'bookings', (select count(*) from live),
      'averageBookingValueMinor', coalesce((select round(avg(total_minor)) from live), 0),
      'averageRentalDays', coalesce((select round(avg(days)::numeric, 2) from live), 0),
      'cancellationRate', coalesce((select round(count(*) filter (where status = 'CANCELLED')::numeric / nullif(count(*), 0), 4) from bk), 0),
      'noShowRate', coalesce((select round(count(*) filter (where status = 'NO_SHOW')::numeric / nullif(count(*), 0), 4) from bk), 0),
      'utilization', case when v_fleet = 0 or v_window_hours = 0 then 0
                          else round(coalesce((select sum(hours) from occ), 0) / (v_fleet * v_window_hours), 4) end,
      'maintenanceCostMinor', coalesce((select sum(cost_minor) from public.maintenance_records where tenant_id = p_tenant
                                        and coalesce(completed_at, scheduled_start) >= v_from and coalesce(completed_at, scheduled_start) < v_to), 0)
                              + coalesce((select sum(amount_minor) from public.expenses where tenant_id = p_tenant and category in ('MAINTENANCE', 'REPAIR')
                                          and incurred_on between p_from and p_to), 0),
      'customerReturnRate', coalesce((select round(count(*) filter (where n > 1)::numeric / nullif(count(*), 0), 4)
                                      from (select customer_id, count(*) n from public.bookings where tenant_id = p_tenant
                                            and status not in ('CANCELLED', 'NO_SHOW', 'DRAFT', 'QUOTE', 'PENDING_PAYMENT') group by customer_id) x), 0)),
    'yearToDateRevenueMinor', coalesce((select sum(case when status in ('CANCELLED', 'NO_SHOW') then coalesce(cancellation_fee_minor, 0) else total_minor end)
                                        from public.bookings where tenant_id = p_tenant and status not in ('DRAFT', 'QUOTE', 'PENDING_PAYMENT')
                                        and starts_at >= (date_trunc('year', now() at time zone tz) at time zone tz)), 0),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'revenueMinor', revenue_minor, 'bookings', bookings) order by day) from series), '[]'),
    'byVehicle', coalesce((select jsonb_agg(x order by (x ->> 'revenueMinor')::bigint desc) from (
        select jsonb_build_object('vehicleId', v.id, 'name', v.make || ' ' || v.model, 'plate', v.registration_plate,
          'revenueMinor', coalesce((select sum(total_minor) from live where live.vehicle_id = v.id), 0),
          'bookings', (select count(*) from live where live.vehicle_id = v.id),
          'utilization', case when v_window_hours = 0 then 0 else round(coalesce((select hours from occ where occ.vehicle_id = v.id), 0) / v_window_hours, 4) end) x
        from public.vehicles v where v.tenant_id = p_tenant and v.status <> 'SOLD') y), '[]'),
    'byBranch', coalesce((select jsonb_agg(jsonb_build_object('branchId', br.id, 'name', br.name,
        'revenueMinor', coalesce((select sum(total_minor) from live where live.pickup_branch_id = br.id), 0),
        'bookings', (select count(*) from live where live.pickup_branch_id = br.id)))
      from public.branches br where br.tenant_id = p_tenant), '[]'),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('category', cat, 'revenueMinor', rev, 'bookings', n)) from (
        select v.category::text cat, sum(live.total_minor) rev, count(*) n from live join public.vehicles v on v.id = live.vehicle_id group by v.category) z), '[]')
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------
-- Platform overview for the super admin.
-- ---------------------------------------------------------------------
create or replace function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'tenantsByStatus', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.tenants group by status) x),
    'subscriptionsByPlan', (select coalesce(jsonb_agg(jsonb_build_object('plan', p.name, 'status', s.status, 'count', s.n)), '[]') from
        (select plan_id, status, count(*) n from public.tenant_subscriptions group by plan_id, status) s join public.subscription_plans p on p.id = s.plan_id),
    'mrrMinor', (select coalesce(sum(case s.interval when 'ANNUAL' then p.annual_price_minor / 12 when 'MONTHLY' then p.monthly_price_minor else 0 end), 0)
                 from public.tenant_subscriptions s join public.subscription_plans p on p.id = s.plan_id where s.status = 'ACTIVE'),
    'bookings30d', (select count(*) from public.bookings where created_at > now() - interval '30 days' and status not in ('DRAFT', 'QUOTE')),
    'gmv30dByCurrency', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
        select currency, sum(amount_captured_minor) total from public.payments where status = 'SUCCEEDED' and created_at > now() - interval '30 days' group by currency) g),
    'platformFees30dMinor', (select coalesce(sum(amount_minor), 0) from public.platform_fees where created_at > now() - interval '30 days'),
    'failedPayments7d', (select count(*) from public.payments where status = 'FAILED' and created_at > now() - interval '7 days'),
    'failedWebhooks', (select count(*) from public.webhook_events where status = 'FAILED'),
    'failedNotifications', (select count(*) from public.notifications where status = 'FAILED'),
    'pendingApprovals', (select count(*) from public.tenants where status = 'PENDING_APPROVAL'),
    'pendingDomains', (select count(*) from public.tenant_domains where status = 'PENDING_VERIFICATION'),
    'pendingPrivacyRequests', (select count(*) from public.privacy_requests where status in ('REQUESTED', 'IN_PROGRESS')),
    'tenantHealth', (select coalesce(jsonb_agg(h order by (h ->> 'bookings30d')::int desc), '[]') from (
        select jsonb_build_object('tenantId', t.id, 'name', t.display_name, 'slug', t.slug, 'status', t.status,
          'vehicles', (select count(*) from public.vehicles v where v.tenant_id = t.id),
          'bookings30d', (select count(*) from public.bookings b where b.tenant_id = t.id and b.created_at > now() - interval '30 days' and b.status not in ('DRAFT', 'QUOTE')),
          'failedPayments7d', (select count(*) from public.payments p where p.tenant_id = t.id and p.status = 'FAILED' and p.created_at > now() - interval '7 days'),
          'paymentsConnected', coalesce((select charges_enabled from public.tenant_payment_accounts a where a.tenant_id = t.id), false),
          'onboardingStep', (select onboarding_step from public.tenant_settings s where s.tenant_id = t.id)) h
        from public.tenants t where t.status <> 'ARCHIVED') hh)
  );
end $$;

-- Platform admin tenant lifecycle with audit reason.
create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status public.tenant_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if p_status = 'SUSPENDED' and coalesce(trim(p_reason), '') = '' then raise exception 'VALIDATION_FAILED' using errcode = 'P0001'; end if;
  update public.tenants set status = p_status,
    suspended_reason = case when p_status = 'SUSPENDED' then p_reason else null end,
    suspended_at = case when p_status = 'SUSPENDED' then now() else null end,
    archived_at = case when p_status = 'ARCHIVED' then now() else archived_at end
  where id = p_tenant;
  if not found then raise exception 'TENANT_NOT_FOUND' using errcode = 'P0001'; end if;
end $$;

-- Vehicle lookup by QR token for staff (returns only if caller can read the vehicle's tenant fleet).
create or replace function public.vehicle_by_qr(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.vehicles;
begin
  select * into v from public.vehicles where qr_token = p_token;
  if not found or not app.has_permission(v.tenant_id, 'vehicles.read') then return null; end if;
  return jsonb_build_object('id', v.id, 'tenantId', v.tenant_id);
end $$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke all on function public.modify_booking(jsonb), public.run_housekeeping() from public, anon, authenticated;
grant execute on function public.modify_booking(jsonb), public.run_housekeeping() to service_role;
revoke all on function public.invite_staff(uuid, text, public.role_key, uuid[]), public.set_membership_status(uuid, public.membership_status),
  public.add_post_rental_charges(uuid, jsonb), public.tenant_dashboard(uuid, date, date), public.platform_overview(),
  public.admin_set_tenant_status(uuid, public.tenant_status, text), public.vehicle_by_qr(text), public.tenant_features(uuid) from public, anon;
grant execute on function public.invite_staff(uuid, text, public.role_key, uuid[]), public.set_membership_status(uuid, public.membership_status),
  public.add_post_rental_charges(uuid, jsonb), public.tenant_dashboard(uuid, date, date), public.platform_overview(),
  public.admin_set_tenant_status(uuid, public.tenant_status, text), public.vehicle_by_qr(text), public.tenant_features(uuid) to authenticated, service_role;
revoke all on function app.feature_enabled(uuid, text), app.enqueue(uuid, uuid, text, text, public.notification_channel[], jsonb, text, timestamptz),
  app.booking_notification_data(public.bookings) from public;
grant execute on function app.feature_enabled(uuid, text) to authenticated, service_role;
