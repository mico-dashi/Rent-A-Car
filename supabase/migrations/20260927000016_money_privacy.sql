-- =====================================================================
-- 0016 REFUND SETTLEMENT, INVOICE NUMBERING, PROVIDER CUSTOMERS, PRIVACY
-- =====================================================================

alter table public.customers add column payment_provider_customer_id text;
create unique index customers_provider_customer on public.customers(payment_provider_customer_id) where payment_provider_customer_id is not null;

-- Settle a refund exactly once: roll the amount into payment and booking totals.
create or replace function public.record_refund(p_refund uuid, p_status text, p_provider_refund_id text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds;
  p public.payments;
begin
  select * into r from public.refunds where id = p_refund for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status = 'SUCCEEDED' then return; end if; -- idempotent
  update public.refunds set status = p_status, provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id) where id = r.id;
  if p_status <> 'SUCCEEDED' then return; end if;
  update public.payments set amount_refunded_minor = amount_refunded_minor + r.amount_minor where id = r.payment_id returning * into p;
  if p.booking_id is not null and p.purpose = 'RENTAL' then
    update public.bookings b set
      amount_refunded_minor = b.amount_refunded_minor + r.amount_minor,
      payment_status = case when b.amount_refunded_minor + r.amount_minor >= b.amount_paid_minor then 'REFUNDED'::public.payment_status
                            else 'PARTIALLY_REFUNDED'::public.payment_status end
    where b.id = p.booking_id;
  end if;
end $$;

-- Gap-free per-tenant document numbers (invoices, receipts, credit notes).
create table public.tenant_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  value bigint not null default 0,
  primary key (tenant_id, key)
);
alter table public.tenant_counters enable row level security;

create or replace function public.next_document_number(p_tenant uuid, p_kind text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v bigint;
  v_key text := p_kind || ':' || extract(year from now())::int;
  v_slug text;
begin
  insert into public.tenant_counters (tenant_id, key, value) values (p_tenant, v_key, 1)
  on conflict (tenant_id, key) do update set value = public.tenant_counters.value + 1
  returning value into v;
  select upper(left(regexp_replace(slug, '[^a-z0-9]', '', 'g'), 6)) into v_slug from public.tenants where id = p_tenant;
  return v_slug || '-' || case p_kind when 'INVOICE' then 'INV' when 'RECEIPT' then 'RCT' else 'CRN' end || '-' || extract(year from now())::int || '-' || lpad(v::text, 5, '0');
end $$;

-- ---------------------------------------------------------------------
-- Privacy: self-service export and deletion request; admin anonymisation.
-- Financial records (bookings, payments, invoices) are retained for legal
-- bookkeeping obligations but detached from personal data.
-- ---------------------------------------------------------------------
create or replace function public.export_my_data() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exportedAt', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'email', (select email from auth.users where id = auth.uid()),
    'customerRecords', (select coalesce(jsonb_agg(to_jsonb(c) - 'payment_provider_customer_id'), '[]') from public.customers c where c.user_id = auth.uid()),
    'driverLicenses', (select coalesce(jsonb_agg(to_jsonb(d) - 'front_image_path' - 'back_image_path'), '[]') from public.driver_licenses d
                       join public.customers c on c.id = d.customer_id where c.user_id = auth.uid()),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object('reference', b.reference, 'status', b.status, 'startsAt', b.starts_at, 'endsAt', b.ends_at,
                   'totalMinor', b.total_minor, 'currency', b.currency, 'tenant', t.display_name)), '[]')
                 from public.bookings b join public.customers c on c.id = b.customer_id join public.tenants t on t.id = b.tenant_id where c.user_id = auth.uid()),
    'consents', (select coalesce(jsonb_agg(to_jsonb(x) - 'ip_address' - 'user_agent'), '[]') from public.consent_records x where x.user_id = auth.uid()),
    'reviews', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.reviews r where r.author_user_id = auth.uid()),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('at', m.created_at, 'body', m.body)), '[]') from public.messages m where m.sender_user_id = auth.uid())
  )
  where auth.uid() is not null
$$;

create or replace function public.request_account_deletion() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  update public.profiles set deletion_requested_at = now() where id = auth.uid();
  insert into public.privacy_requests (user_id, kind) values (auth.uid(), 'DELETE') returning id into v;
  return v;
end $$;

create or replace function public.admin_anonymize_user(p_user uuid, p_request uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_active integer;
begin
  if not app.is_platform_admin() and not app.is_service_call() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  select count(*) into v_active from public.bookings b join public.customers c on c.id = b.customer_id
   where c.user_id = p_user and b.status in ('ACTIVE', 'RETURN_DUE', 'DISPUTED');
  if v_active > 0 then raise exception 'ACTIVE_RENTALS_EXIST' using errcode = 'P0001'; end if;
  update public.customers set first_name = 'Deleted', last_name = 'User', email = 'deleted+' || id || '@invalid.example', phone = null,
    date_of_birth = null, address_line1 = null, address_line2 = null, city = null, postal_code = null, emergency_contact_name = null,
    emergency_contact_phone = null, identity_provider_ref = null, preferences = '{}', marketing_opt_in = false, user_id = null
   where user_id = p_user;
  delete from public.driver_licenses d using public.customers c where d.customer_id = c.id and c.email like 'deleted+%' and c.first_name = 'Deleted';
  delete from public.customer_documents d using public.customers c where d.customer_id = c.id and c.email like 'deleted+%' and c.first_name = 'Deleted';
  update public.profiles set first_name = null, last_name = null, phone = null, avatar_path = null where id = p_user;
  delete from public.push_tokens where user_id = p_user;
  delete from public.favorites where user_id = p_user;
  update public.privacy_requests set status = 'COMPLETED' where id = p_request or (user_id = p_user and kind = 'DELETE' and status <> 'COMPLETED');
end $$;

revoke all on function public.record_refund(uuid, text, text), public.next_document_number(uuid, text) from public, anon, authenticated;
grant execute on function public.record_refund(uuid, text, text), public.next_document_number(uuid, text) to service_role;
revoke all on function public.export_my_data(), public.request_account_deletion(), public.admin_anonymize_user(uuid, uuid) from public, anon;
grant execute on function public.export_my_data(), public.request_account_deletion(), public.admin_anonymize_user(uuid, uuid) to authenticated, service_role;

-- Paid amount counts every captured charge on the booking (rental, captured
-- deposit covering approved charges, late fees, damage), not just the rental PI.
create or replace function public.record_booking_payment(p_booking uuid, p_amount_minor bigint, p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  s public.tenant_settings;
  v_range tstzrange;
  v_next public.booking_status;
  v_paid bigint;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.payments where id = p_payment_id and booking_id = p_booking and status = 'SUCCEEDED') then
    raise exception 'PAYMENT_NOT_SUCCEEDED' using errcode = 'P0001';
  end if;
  select * into s from public.tenant_settings where tenant_id = b.tenant_id;
  select coalesce(sum(amount_captured_minor), 0) into v_paid from public.payments where booking_id = p_booking and status = 'SUCCEEDED';
  update public.bookings set amount_paid_minor = v_paid,
    payment_status = case when v_paid - amount_refunded_minor >= total_minor then 'PAID'::public.payment_status
                          when amount_refunded_minor > 0 then 'PARTIALLY_REFUNDED'::public.payment_status
                          else 'PARTIALLY_PAID'::public.payment_status end
  where id = p_booking;

  if b.status = 'PENDING_PAYMENT' or (b.status = 'CANCELLED' and b.cancellation_reason = 'HOLD_EXPIRED') then
    if b.status = 'CANCELLED' then
      v_range := app.occupancy_range(b.tenant_id, b.starts_at, b.ends_at);
      if b.vehicle_id is null or not app.vehicle_is_free(b.vehicle_id, v_range) then
        return jsonb_build_object('status', 'HOLD_LOST', 'refund_required', true);
      end if;
      insert into public.vehicle_availability_blocks (tenant_id, vehicle_id, kind, period, booking_id)
      values (b.tenant_id, b.vehicle_id, 'BOOKING', v_range, b.id);
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
alter table public.refunds alter column requested_by drop not null;
