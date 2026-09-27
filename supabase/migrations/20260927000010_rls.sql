-- =====================================================================
-- 0010 ROW LEVEL SECURITY
-- Default deny: RLS is enabled on every public table; access exists
-- only where a policy below grants it. service_role bypasses RLS and is
-- used exclusively by server routes / edge functions.
-- =====================================================================

-- Enable RLS on every table in public.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- True for trusted server contexts (service_role / migrations), false for API users.
create or replace function app.is_trusted_context() returns boolean
language sql stable as $$ select current_user not in ('authenticated', 'anon') $$;
grant execute on function app.is_trusted_context() to authenticated, anon, service_role;

-- Caller owns this customer record.
create or replace function app.owns_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customers c where c.id = p_customer and c.user_id = auth.uid());
$$;
-- Caller is the customer on this booking.
create or replace function app.owns_booking(p_booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b join public.customers c on c.id = b.customer_id
                 where b.id = p_booking and c.user_id = auth.uid());
$$;
create or replace function app.can_read_booking(p_booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking
      and ((app.has_permission(b.tenant_id, 'bookings.read') and app.has_branch_access(b.tenant_id, b.pickup_branch_id))
           or app.owns_booking(b.id) or app.is_platform_admin()));
$$;
grant execute on function app.owns_customer(uuid), app.owns_booking(uuid), app.can_read_booking(uuid)
  to authenticated, anon, service_role;

-- Helper: standard staff CRUD policies driven by permission keys.
create or replace function app.staff_policies(p_table text, p_read text, p_write text) returns void
language plpgsql as $$
begin
  execute format('create policy staff_select on public.%I for select to authenticated using (app.has_permission(tenant_id, %L))', p_table, p_read);
  execute format('create policy staff_insert on public.%I for insert to authenticated with check (app.has_permission(tenant_id, %L))', p_table, p_write);
  execute format('create policy staff_update on public.%I for update to authenticated using (app.has_permission(tenant_id, %L)) with check (app.has_permission(tenant_id, %L))', p_table, p_write, p_write);
  execute format('create policy staff_delete on public.%I for delete to authenticated using (app.has_permission(tenant_id, %L))', p_table, p_write);
end $$;

-- Platform admins can read everything (super-admin dashboard).
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
           and tablename not in ('webhook_events', 'idempotency_keys') loop
    execute format('create policy platform_admin_select on public.%I for select to authenticated using (app.is_platform_admin())', r.tablename);
  end loop;
end $$;
create policy platform_admin_select on public.webhook_events for select to authenticated using (app.is_platform_admin());

-- Platform admins manage platform-level tables.
do $$
declare t text;
begin
  foreach t in array array['currencies', 'languages', 'subscription_plans', 'coupons', 'platform_announcements',
                           'tenants', 'tenant_subscriptions', 'feature_flags', 'tenant_domains', 'privacy_requests',
                           'notification_templates'] loop
    execute format('create policy platform_admin_write on public.%I for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin())', t);
  end loop;
end $$;
create policy platform_admin_moderate on public.reviews for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

-- ---------------- Reference data ----------------
create policy public_read on public.currencies for select to anon, authenticated using (is_enabled);
create policy public_read on public.languages for select to anon, authenticated using (is_enabled);
create policy public_read on public.subscription_plans for select to anon, authenticated using (is_public);
create policy public_read on public.permissions for select to authenticated using (true);
create policy public_read on public.roles for select to authenticated using (true);
create policy public_read on public.role_permissions for select to authenticated using (true);
create policy public_read on public.booking_status_transitions for select to anon, authenticated using (true);
create policy member_read on public.platform_announcements for select to authenticated
  using (starts_at <= now() and (ends_at is null or ends_at > now()));

-- ---------------- Identity ----------------
create policy own_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy own_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy colleague_select on public.profiles for select to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = profiles.id and app.has_permission(m.tenant_id, 'staff.read')));

-- ---------------- Tenancy ----------------
create policy member_select on public.tenants for select to authenticated using (app.is_member(id));
create policy owner_update on public.tenants for update to authenticated
  using (app.has_permission(id, 'tenant.manage')) with check (app.has_permission(id, 'tenant.manage'));

create policy member_select on public.tenant_settings for select to authenticated using (app.has_permission(tenant_id, 'tenant.read'));
create policy manage_update on public.tenant_settings for update to authenticated
  using (app.has_permission(tenant_id, 'tenant.manage')) with check (app.has_permission(tenant_id, 'tenant.manage'));

create policy public_select on public.tenant_branding for select to anon, authenticated
  using (app.tenant_is_public(tenant_id) or app.is_member(tenant_id));
create policy manage_update on public.tenant_branding for update to authenticated
  using (app.has_permission(tenant_id, 'branding.manage')) with check (app.has_permission(tenant_id, 'branding.manage'));

select app.staff_policies('tenant_domains', 'tenant.read', 'domains.manage');
create policy member_select on public.tenant_subscriptions for select to authenticated using (app.has_permission(tenant_id, 'tenant.read'));
create policy member_select on public.feature_flags for select to authenticated
  using (tenant_id is null or app.is_member(tenant_id));
create policy member_select on public.tenant_payment_accounts for select to authenticated
  using (app.has_permission(tenant_id, 'payments.read') or app.has_permission(tenant_id, 'billing.manage'));
create policy billing_select on public.platform_fees for select to authenticated using (app.has_permission(tenant_id, 'billing.manage'));

create policy self_or_staff_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or app.has_permission(tenant_id, 'staff.read'));
create policy staff_insert on public.memberships for insert to authenticated with check (app.has_permission(tenant_id, 'staff.manage'));
create policy staff_update on public.memberships for update to authenticated
  using (app.has_permission(tenant_id, 'staff.manage')) with check (app.has_permission(tenant_id, 'staff.manage'));
create policy staff_delete on public.memberships for delete to authenticated using (app.has_permission(tenant_id, 'staff.manage'));
select app.staff_policies('membership_permission_overrides', 'staff.read', 'staff.manage');

-- ---------------- Fleet ----------------
create policy public_select on public.branches for select to anon, authenticated
  using (is_active and app.tenant_is_public(tenant_id));
select app.staff_policies('branches', 'branches.read', 'branches.write');

create policy public_select on public.one_way_fees for select to anon, authenticated using (app.tenant_is_public(tenant_id));
select app.staff_policies('one_way_fees', 'pricing.read', 'pricing.manage');

create policy public_select on public.vehicle_classes for select to anon, authenticated using (app.tenant_is_public(tenant_id));
select app.staff_policies('vehicle_classes', 'vehicles.read', 'vehicles.write');

-- vehicles base table holds internal fields (VIN, purchase price): staff only.
-- Public catalogue access goes through public.catalog_vehicles (0011).
create policy staff_select on public.vehicles for select to authenticated
  using (app.has_permission(tenant_id, 'vehicles.read') and app.has_branch_access(tenant_id, branch_id));
create policy staff_insert on public.vehicles for insert to authenticated with check (app.has_permission(tenant_id, 'vehicles.write'));
create policy staff_update on public.vehicles for update to authenticated
  using (app.has_permission(tenant_id, 'vehicles.write') or app.has_permission(tenant_id, 'vehicles.status'))
  with check (app.has_permission(tenant_id, 'vehicles.write') or app.has_permission(tenant_id, 'vehicles.status'));
create policy staff_delete on public.vehicles for delete to authenticated using (app.has_permission(tenant_id, 'vehicles.write'));

select app.staff_policies('vehicle_class_members', 'vehicles.read', 'vehicles.write');

create policy public_select on public.vehicle_images for select to anon, authenticated using (
  app.tenant_is_public(tenant_id) and exists (select 1 from public.vehicles v where v.id = vehicle_id and v.is_published));
select app.staff_policies('vehicle_images', 'vehicles.read', 'vehicles.write');
create policy public_select on public.vehicle_features for select to anon, authenticated using (
  app.tenant_is_public(tenant_id) and exists (select 1 from public.vehicles v where v.id = vehicle_id and v.is_published));
select app.staff_policies('vehicle_features', 'vehicles.read', 'vehicles.write');
select app.staff_policies('vehicle_documents', 'vehicles.read', 'vehicles.write');
create policy staff_select on public.vehicle_status_history for select to authenticated using (app.has_permission(tenant_id, 'vehicles.read'));

create policy staff_select on public.vehicle_availability_blocks for select to authenticated
  using (app.has_permission(tenant_id, 'vehicles.read') or app.has_permission(tenant_id, 'bookings.read'));
-- Staff may create/release MANUAL and CLEANING blocks directly; booking/maintenance/transfer blocks are system-managed.
create policy staff_insert on public.vehicle_availability_blocks for insert to authenticated
  with check (kind in ('MANUAL', 'CLEANING') and booking_id is null and app.has_permission(tenant_id, 'vehicles.status'));
create policy staff_update on public.vehicle_availability_blocks for update to authenticated
  using (kind in ('MANUAL', 'CLEANING') and app.has_permission(tenant_id, 'vehicles.status'))
  with check (kind in ('MANUAL', 'CLEANING') and booking_id is null and app.has_permission(tenant_id, 'vehicles.status'));

create policy staff_select on public.vehicle_transfers for select to authenticated
  using (app.has_permission(tenant_id, 'vehicles.read') or app.has_permission(tenant_id, 'transfers.manage'));
create policy staff_write on public.vehicle_transfers for all to authenticated
  using (app.has_permission(tenant_id, 'transfers.manage')) with check (app.has_permission(tenant_id, 'transfers.manage'));

-- ---------------- Customers ----------------
create policy own_select on public.customers for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.customers for insert to authenticated
  with check (user_id = (select auth.uid()) and app.tenant_is_public(tenant_id)
              and identity_status = 'UNVERIFIED' and not is_restricted);
create policy own_update on public.customers for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
select app.staff_policies('customers', 'customers.read', 'customers.write');

create policy own_select on public.driver_licenses for select to authenticated using (app.owns_customer(customer_id));
create policy own_insert on public.driver_licenses for insert to authenticated
  with check (app.owns_customer(customer_id) and verification_status = 'UNVERIFIED');
create policy own_update on public.driver_licenses for update to authenticated
  using (app.owns_customer(customer_id) and verification_status <> 'VERIFIED') with check (app.owns_customer(customer_id));
select app.staff_policies('driver_licenses', 'customers.documents', 'customers.documents');

create policy own_select on public.customer_documents for select to authenticated using (app.owns_customer(customer_id));
create policy own_insert on public.customer_documents for insert to authenticated
  with check (app.owns_customer(customer_id) and verification_status = 'PENDING');
select app.staff_policies('customer_documents', 'customers.documents', 'customers.documents');

create policy staff_select on public.customer_restrictions for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy staff_insert on public.customer_restrictions for insert to authenticated
  with check (app.has_permission(tenant_id, 'customers.restrict') and actor_id = (select auth.uid()));

create policy staff_select on public.customer_notes for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy staff_insert on public.customer_notes for insert to authenticated
  with check (app.has_permission(tenant_id, 'customers.write') and author_id = (select auth.uid()));

create policy own_all on public.favorites for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and app.tenant_is_public(tenant_id));

-- ---------------- Pricing ----------------
create policy public_select on public.tax_rules for select to anon, authenticated using (app.tenant_is_public(tenant_id));
select app.staff_policies('tax_rules', 'pricing.read', 'pricing.manage');
create policy public_select on public.seasonal_rates for select to anon, authenticated using (app.tenant_is_public(tenant_id));
select app.staff_policies('seasonal_rates', 'pricing.read', 'pricing.manage');
select app.staff_policies('pricing_rules', 'pricing.read', 'pricing.manage');
select app.staff_policies('discount_codes', 'pricing.read', 'pricing.manage');
create policy public_select on public.extras for select to anon, authenticated using (is_active and app.tenant_is_public(tenant_id));
select app.staff_policies('extras', 'pricing.read', 'extras.manage');

-- ---------------- Bookings (read-only via RLS; writes via RPC) ----------------
create policy read_booking on public.bookings for select to authenticated using (
  (app.has_permission(tenant_id, 'bookings.read') and app.has_branch_access(tenant_id, pickup_branch_id))
  or app.owns_customer(customer_id));
create policy read_booking on public.booking_status_history for select to authenticated using (app.can_read_booking(booking_id));
create policy read_booking on public.booking_extras for select to authenticated using (app.can_read_booking(booking_id));
create policy read_booking on public.booking_price_lines for select to authenticated using (app.can_read_booking(booking_id));
create policy staff_select on public.booking_vehicle_assignments for select to authenticated using (app.has_permission(tenant_id, 'bookings.read'));

create policy staff_select on public.booking_notes for select to authenticated using (app.has_permission(tenant_id, 'bookings.read'));
create policy customer_select on public.booking_notes for select to authenticated using (not is_internal and app.owns_booking(booking_id));
create policy staff_insert on public.booking_notes for insert to authenticated
  with check (app.has_permission(tenant_id, 'bookings.write') and author_id = (select auth.uid()));
create policy customer_insert on public.booking_notes for insert to authenticated
  with check (not is_internal and app.owns_booking(booking_id) and author_id = (select auth.uid()));

-- ---------------- Payments (read-only via RLS) ----------------
create policy own_select on public.payment_methods for select to authenticated using (app.owns_customer(customer_id));
create policy staff_select on public.payment_methods for select to authenticated using (app.has_permission(tenant_id, 'payments.read'));
create policy own_select on public.payments for select to authenticated using (app.owns_customer(customer_id));
create policy staff_select on public.payments for select to authenticated using (app.has_permission(tenant_id, 'payments.read'));
create policy staff_select on public.payment_transactions for select to authenticated using (app.has_permission(tenant_id, 'payments.read'));
create policy own_select on public.refunds for select to authenticated using (booking_id is not null and app.owns_booking(booking_id));
create policy staff_select on public.refunds for select to authenticated using (app.has_permission(tenant_id, 'payments.read'));
create policy own_select on public.security_deposits for select to authenticated using (app.owns_booking(booking_id));
create policy staff_select on public.security_deposits for select to authenticated using (app.has_permission(tenant_id, 'payments.read'));
create policy own_select on public.invoices for select to authenticated using (customer_id is not null and app.owns_customer(customer_id));
create policy staff_select on public.invoices for select to authenticated using (app.has_permission(tenant_id, 'payments.read'));

-- ---------------- Operations ----------------
create policy staff_select on public.agreement_templates for select to authenticated using (app.has_permission(tenant_id, 'tenant.read'));
create policy staff_write on public.agreement_templates for all to authenticated
  using (app.has_permission(tenant_id, 'agreements.manage')) with check (app.has_permission(tenant_id, 'agreements.manage'));
create policy read_agreement on public.rental_agreements for select to authenticated using (app.can_read_booking(booking_id));
create policy read_signature on public.signatures for select to authenticated using (
  app.has_permission(tenant_id, 'bookings.read')
  or exists (select 1 from public.rental_agreements a where a.id = agreement_id and app.owns_booking(a.booking_id)));

create policy own_select on public.consent_records for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.consent_records for insert to authenticated with check (user_id = (select auth.uid()));
create policy staff_select on public.consent_records for select to authenticated
  using (tenant_id is not null and app.has_permission(tenant_id, 'customers.read'));

create policy staff_select on public.vehicle_inspections for select to authenticated
  using (app.has_permission(tenant_id, 'inspections.perform') or app.has_permission(tenant_id, 'bookings.read'));
create policy customer_select on public.vehicle_inspections for select to authenticated
  using (booking_id is not null and app.owns_booking(booking_id));
create policy staff_insert on public.vehicle_inspections for insert to authenticated
  with check (app.has_permission(tenant_id, 'inspections.perform') and performed_by = (select auth.uid()) and status <> 'LOCKED');
create policy staff_update on public.vehicle_inspections for update to authenticated
  using (app.has_permission(tenant_id, 'inspections.perform'))
  with check (app.has_permission(tenant_id, 'inspections.perform') and status <> 'LOCKED');

create policy staff_select on public.inspection_photos for select to authenticated
  using (app.has_permission(tenant_id, 'inspections.perform') or app.has_permission(tenant_id, 'bookings.read'));
create policy customer_select on public.inspection_photos for select to authenticated using (
  exists (select 1 from public.vehicle_inspections i where i.id = inspection_id and i.booking_id is not null and app.owns_booking(i.booking_id)));
create policy staff_insert on public.inspection_photos for insert to authenticated
  with check (app.has_permission(tenant_id, 'inspections.perform'));

create policy staff_select on public.vehicle_damages for select to authenticated using (app.has_permission(tenant_id, 'damages.read'));
create policy customer_select on public.vehicle_damages for select to authenticated
  using (booking_id is not null and app.owns_booking(booking_id));
create policy inspector_insert on public.vehicle_damages for insert to authenticated
  with check ((app.has_permission(tenant_id, 'inspections.perform') and status = 'REPORTED' and decided_by is null)
              or app.has_permission(tenant_id, 'damages.manage'));
create policy manager_update on public.vehicle_damages for update to authenticated
  using (app.has_permission(tenant_id, 'damages.manage')) with check (app.has_permission(tenant_id, 'damages.manage'));

create policy staff_select on public.damage_ai_assessments for select to authenticated using (app.has_permission(tenant_id, 'damages.read'));
create policy manager_review on public.damage_ai_assessments for update to authenticated
  using (app.has_permission(tenant_id, 'damages.manage'))
  with check (app.has_permission(tenant_id, 'damages.manage') and (review_status = 'PENDING_REVIEW' or reviewed_by = (select auth.uid())));

select app.staff_policies('maintenance_records', 'maintenance.read', 'maintenance.manage');
select app.staff_policies('expenses', 'expenses.read', 'expenses.manage');

-- ---------------- Engagement ----------------
create policy read_templates on public.notification_templates for select to authenticated
  using (tenant_id is null or app.has_permission(tenant_id, 'tenant.read'));
create policy tenant_write on public.notification_templates for all to authenticated
  using (tenant_id is not null and app.has_permission(tenant_id, 'notifications.manage'))
  with check (tenant_id is not null and app.has_permission(tenant_id, 'notifications.manage'));
create policy own_all on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_all on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy own_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and channel = 'IN_APP') with check (user_id = (select auth.uid()));

create policy public_select on public.reviews for select to anon, authenticated using (is_published and app.tenant_is_public(tenant_id));
create policy own_select on public.reviews for select to authenticated using (author_user_id = (select auth.uid()));
create policy staff_select on public.reviews for select to authenticated using (app.is_member(tenant_id));
create policy own_insert on public.reviews for insert to authenticated
  with check (author_user_id = (select auth.uid()) and is_published and hidden_reason is null);
create policy own_update on public.reviews for update to authenticated
  using (author_user_id = (select auth.uid())) with check (author_user_id = (select auth.uid()));

create policy public_select on public.review_replies for select to anon, authenticated using (app.tenant_is_public(tenant_id));
create policy staff_write on public.review_replies for all to authenticated
  using (app.has_permission(tenant_id, 'reviews.reply'))
  with check (app.has_permission(tenant_id, 'reviews.reply') and author_id = (select auth.uid()));

create policy own_select on public.message_threads for select to authenticated using (app.owns_customer(customer_id));
create policy own_insert on public.message_threads for insert to authenticated
  with check (app.owns_customer(customer_id) and (booking_id is null or app.owns_booking(booking_id)));
create policy staff_select on public.message_threads for select to authenticated using (app.has_permission(tenant_id, 'messages.read'));
create policy staff_write on public.message_threads for insert to authenticated with check (app.has_permission(tenant_id, 'messages.write'));
create policy staff_update on public.message_threads for update to authenticated
  using (app.has_permission(tenant_id, 'messages.write')) with check (app.has_permission(tenant_id, 'messages.write'));

create policy thread_select on public.messages for select to authenticated using (
  app.has_permission(tenant_id, 'messages.read')
  or exists (select 1 from public.message_threads t where t.id = thread_id and app.owns_customer(t.customer_id)));
create policy customer_insert on public.messages for insert to authenticated with check (
  sender_kind = 'CUSTOMER' and sender_user_id = (select auth.uid())
  and exists (select 1 from public.message_threads t where t.id = thread_id and t.status = 'OPEN' and app.owns_customer(t.customer_id)));
create policy staff_insert on public.messages for insert to authenticated with check (
  sender_kind = 'STAFF' and sender_user_id = (select auth.uid()) and app.has_permission(tenant_id, 'messages.write'));

create policy own_select on public.privacy_requests for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.privacy_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'REQUESTED');

create policy audit_select on public.audit_logs for select to authenticated
  using (tenant_id is not null and app.has_permission(tenant_id, 'audit.read'));

-- =====================================================================
-- Column-level guard triggers (RLS is row-level; these stop privilege
-- escalation through columns a policy would otherwise allow).
-- SECURITY INVOKER so current_user reflects the API caller.
-- =====================================================================

create or replace function app.guard_tenant_update() returns trigger
language plpgsql as $$
begin
  if app.is_trusted_context() or app.is_platform_admin() then return new; end if;
  if (new.status, new.suspended_reason, new.suspended_at, new.archived_at, new.owner_user_id, new.tenant_code, new.slug)
     is distinct from
     (old.status, old.suspended_reason, old.suspended_at, old.archived_at, old.owner_user_id, old.tenant_code, old.slug) then
    raise exception 'Only the platform can change tenant status, ownership or slug' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_tenant_update before update on public.tenants for each row execute function app.guard_tenant_update();

create or replace function app.guard_domain_write() returns trigger
language plpgsql as $$
begin
  if app.is_trusted_context() or app.is_platform_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'PENDING_VERIFICATION' or new.verified_at is not null or new.is_platform_subdomain then
      raise exception 'Domains must be verified by the platform' using errcode = '42501';
    end if;
  elsif (new.status, new.verified_at, new.is_platform_subdomain, new.hostname, new.verification_token)
        is distinct from (old.status, old.verified_at, old.is_platform_subdomain, old.hostname, old.verification_token) then
    raise exception 'Domain verification fields are platform-managed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_domain_write before insert or update on public.tenant_domains
  for each row execute function app.guard_domain_write();

-- Staff management: no one can grant a role at or above their own rank
-- (owners excepted), and the owner membership cannot be modified by others.
create or replace function app.guard_membership_write() returns trigger
language plpgsql as $$
declare
  v_my_rank smallint;
  v_target_rank smallint;
  v_old_rank smallint;
begin
  if app.is_trusted_context() or app.is_platform_admin() then return coalesce(new, old); end if;
  select r.rank into v_my_rank from public.memberships m join public.roles r on r.key = m.role
   where m.tenant_id = coalesce(new.tenant_id, old.tenant_id) and m.user_id = auth.uid() and m.status = 'ACTIVE';
  if v_my_rank is null then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select rank into v_old_rank from public.roles where key = old.role;
    if old.role = 'TENANT_OWNER' then
      raise exception 'Owner membership can only be changed by the platform' using errcode = '42501';
    end if;
    if v_old_rank <= v_my_rank and v_my_rank <> 10 then
      raise exception 'Cannot modify a member of equal or higher role' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if new.user_id is distinct from old.user_id then
      raise exception 'Membership user is immutable' using errcode = '42501';
    end if;
  end if;
  select rank into v_target_rank from public.roles where key = new.role;
  if new.role = 'TENANT_OWNER' or (v_target_rank <= v_my_rank and v_my_rank <> 10) then
    raise exception 'Cannot assign a role at or above your own' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.user_id is not null and new.status = 'ACTIVE' then
    raise exception 'Staff must accept an invitation' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_membership_write before insert or update or delete on public.memberships
  for each row execute function app.guard_membership_write();

-- Holders of vehicles.status (but not vehicles.write) may only change operational fields.
create or replace function app.guard_vehicle_update() returns trigger
language plpgsql as $$
begin
  if app.is_trusted_context() or app.has_permission(new.tenant_id, 'vehicles.write') then return new; end if;
  if (to_jsonb(new) - array['status', 'fuel_level_eighths', 'battery_level_pct', 'odometer_km', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'fuel_level_eighths', 'battery_level_pct', 'odometer_km', 'updated_at']) then
    raise exception 'vehicles.status only permits operational field changes' using errcode = '42501';
  end if;
  if new.odometer_km < old.odometer_km then
    raise exception 'Odometer cannot decrease' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_vehicle_update before update on public.vehicles for each row execute function app.guard_vehicle_update();

-- Customers editing themselves cannot touch verification / restriction / linkage fields.
create or replace function app.guard_customer_update() returns trigger
language plpgsql as $$
begin
  if app.is_trusted_context() then return new; end if;
  if new.is_restricted is distinct from old.is_restricted then
    raise exception 'Use customer_restrictions to restrict customers' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'Customer account link is immutable' using errcode = '42501';
  end if;
  if (new.identity_status, new.identity_provider, new.identity_provider_ref, new.identity_verified_at)
     is distinct from (old.identity_status, old.identity_provider, old.identity_provider_ref, old.identity_verified_at)
     and not app.has_permission(new.tenant_id, 'customers.documents') then
    raise exception 'Identity verification fields are staff/provider-managed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_customer_update before update on public.customers for each row execute function app.guard_customer_update();

create or replace function app.guard_document_verification() returns trigger
language plpgsql as $$
begin
  if app.is_trusted_context() or app.has_permission(new.tenant_id, 'customers.documents') then return new; end if;
  if (new.verification_status, new.verified_by, new.verified_at)
     is distinct from (old.verification_status, old.verified_by, old.verified_at) then
    raise exception 'Only authorised staff can verify documents' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_document_verification before update on public.driver_licenses
  for each row execute function app.guard_document_verification();
create trigger guard_document_verification before update on public.customer_documents
  for each row execute function app.guard_document_verification();

-- Damage decisions must be attributed to the deciding human.
create or replace function app.guard_damage_decision() returns trigger
language plpgsql as $$
begin
  if app.is_trusted_context() then return new; end if;
  if new.status in ('CUSTOMER_RESPONSIBLE', 'COMPANY_RESPONSIBLE', 'INSURANCE')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger guard_damage_decision before insert or update on public.vehicle_damages
  for each row execute function app.guard_damage_decision();

-- Customers can only mark their in-app notifications read.
create or replace function app.guard_notification_update() returns trigger
language plpgsql as $$
begin
  if app.is_trusted_context() then return new; end if;
  if (to_jsonb(new) - array['read_at', 'status']) is distinct from (to_jsonb(old) - array['read_at', 'status'])
     or new.status not in ('READ', old.status) then
    raise exception 'Only read state can be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_notification_update before update on public.notifications
  for each row execute function app.guard_notification_update();

-- Table privileges: API roles get DML; RLS decides which rows.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated, service_role;
-- Sensitive system tables: never directly writable by API users even if a policy slipped in.
revoke insert, update, delete on public.audit_logs, public.webhook_events, public.idempotency_keys,
  public.payments, public.payment_transactions, public.refunds, public.security_deposits, public.invoices,
  public.platform_fees, public.bookings, public.booking_status_history, public.booking_vehicle_assignments,
  public.booking_extras, public.booking_price_lines, public.vehicle_status_history, public.platform_admins,
  public.rental_agreements, public.signatures, public.tenant_payment_accounts, public.booking_status_transitions,
  public.permissions, public.roles, public.role_permissions
from authenticated;
revoke select on public.webhook_events, public.idempotency_keys from anon, authenticated;
grant select on public.webhook_events to authenticated; -- still gated by platform_admin_select policy
