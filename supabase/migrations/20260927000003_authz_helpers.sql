-- =====================================================================
-- 0003 AUTHORIZATION: permission catalogue + security-definer helpers
-- Helpers live in the private `app` schema (not exposed over the API).
-- They are SECURITY DEFINER so they can read memberships without
-- recursive RLS evaluation, and they pin search_path.
-- =====================================================================

insert into public.roles (key, name, rank) values
  ('TENANT_OWNER', 'Owner', 10),
  ('TENANT_ADMIN', 'Administrator', 20),
  ('MANAGER', 'Manager', 30),
  ('EMPLOYEE', 'Employee', 40),
  ('DRIVER', 'Driver', 50);

insert into public.permissions (key, description) values
  ('tenant.read', 'View business profile'),
  ('tenant.manage', 'Edit business settings and rental rules'),
  ('branding.manage', 'Edit branding and website content'),
  ('domains.manage', 'Manage custom domains'),
  ('billing.manage', 'Manage SaaS subscription and payment connection'),
  ('branches.read', 'View branches'),
  ('branches.write', 'Create and edit branches'),
  ('vehicles.read', 'View fleet including internal fields'),
  ('vehicles.write', 'Create and edit vehicles'),
  ('vehicles.status', 'Change operational vehicle status'),
  ('pricing.read', 'View pricing rules'),
  ('pricing.manage', 'Edit rates, pricing rules, taxes, discounts'),
  ('extras.manage', 'Edit extras catalogue'),
  ('bookings.read', 'View bookings'),
  ('bookings.write', 'Create and modify bookings'),
  ('bookings.cancel', 'Cancel bookings'),
  ('bookings.override', 'Override booking rules and statuses'),
  ('payments.read', 'View payments'),
  ('payments.charge', 'Take payments and approved charges'),
  ('payments.refund', 'Issue refunds'),
  ('deposits.manage', 'Authorize, capture and release deposits'),
  ('customers.read', 'View customers'),
  ('customers.write', 'Edit customers'),
  ('customers.restrict', 'Restrict or blacklist customers'),
  ('customers.documents', 'View and verify customer identity documents'),
  ('inspections.perform', 'Perform pickup/return inspections'),
  ('damages.read', 'View damage records'),
  ('damages.manage', 'Decide damage responsibility and charges'),
  ('maintenance.read', 'View maintenance'),
  ('maintenance.manage', 'Schedule and complete maintenance'),
  ('expenses.read', 'View expenses'),
  ('expenses.manage', 'Record expenses'),
  ('transfers.manage', 'Manage vehicle transfers and deliveries'),
  ('staff.read', 'View staff'),
  ('staff.manage', 'Invite, suspend and assign staff'),
  ('reports.read', 'View analytics and reports'),
  ('messages.read', 'Read customer messages'),
  ('messages.write', 'Reply to customer messages'),
  ('reviews.reply', 'Reply to reviews'),
  ('notifications.manage', 'Edit notification templates'),
  ('agreements.manage', 'Generate and countersign rental agreements'),
  ('audit.read', 'View audit log');

-- Owner: everything
insert into public.role_permissions (role, permission) select 'TENANT_OWNER', key from public.permissions;
-- Admin: everything but SaaS billing
insert into public.role_permissions (role, permission)
  select 'TENANT_ADMIN', key from public.permissions where key <> 'billing.manage';
-- Manager
insert into public.role_permissions (role, permission)
  select 'MANAGER', key from public.permissions where key in (
    'tenant.read', 'branches.read', 'vehicles.read', 'vehicles.write', 'vehicles.status', 'pricing.read',
    'bookings.read', 'bookings.write', 'bookings.cancel', 'payments.read', 'payments.charge', 'deposits.manage',
    'customers.read', 'customers.write', 'customers.restrict', 'customers.documents', 'inspections.perform',
    'damages.read', 'damages.manage', 'maintenance.read', 'maintenance.manage', 'expenses.read',
    'expenses.manage', 'transfers.manage', 'staff.read', 'reports.read', 'messages.read', 'messages.write',
    'reviews.reply', 'agreements.manage');
-- Employee
insert into public.role_permissions (role, permission)
  select 'EMPLOYEE', key from public.permissions where key in (
    'tenant.read', 'branches.read', 'vehicles.read', 'vehicles.status', 'pricing.read', 'bookings.read',
    'bookings.write', 'payments.read', 'customers.read', 'customers.write', 'customers.documents',
    'inspections.perform', 'damages.read', 'maintenance.read', 'messages.read', 'messages.write',
    'agreements.manage');
-- Driver
insert into public.role_permissions (role, permission)
  select 'DRIVER', key from public.permissions where key in (
    'tenant.read', 'branches.read', 'vehicles.read', 'vehicles.status', 'bookings.read',
    'inspections.perform', 'transfers.manage', 'messages.read');

-- ---------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid());
$$;

-- Active membership row for the caller in a tenant (null if none).
create or replace function app.current_membership(p_tenant uuid) returns public.memberships
language sql stable security definer set search_path = '' as $$
  select m.* from public.memberships m
  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'ACTIVE'
  limit 1;
$$;

create or replace function app.is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'ACTIVE'
      and t.status <> 'ARCHIVED'
  );
$$;

-- Core permission check. Read permissions remain available while a tenant
-- is suspended (so owners can export data); all writes are denied.
create or replace function app.has_permission(p_tenant uuid, p_permission text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_membership public.memberships;
  v_tenant_status public.tenant_status;
  v_override boolean;
begin
  if auth.uid() is null or p_tenant is null then
    return false;
  end if;

  select status into v_tenant_status from public.tenants where id = p_tenant;
  if v_tenant_status is null or v_tenant_status = 'ARCHIVED' then
    return false;
  end if;
  if v_tenant_status = 'SUSPENDED' and p_permission not like '%.read' then
    return false;
  end if;

  select * into v_membership from public.memberships
   where tenant_id = p_tenant and user_id = auth.uid() and status = 'ACTIVE';
  if not found then
    return false;
  end if;

  select granted into v_override from public.membership_permission_overrides
   where membership_id = v_membership.id and permission = p_permission;
  if found then
    return v_override;
  end if;

  return exists (
    select 1 from public.role_permissions rp
    where rp.role = v_membership.role and rp.permission = p_permission
  );
end $$;

-- Branch scoping: staff restricted to specific branches only see those.
create or replace function app.has_branch_access(p_tenant uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'ACTIVE'
      and (cardinality(m.branch_ids) = 0 or p_branch is null or p_branch = any (m.branch_ids))
  );
$$;

-- Tenants whose storefront is publicly visible.
create or replace function app.tenant_is_public(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenants t where t.id = p_tenant and t.status = 'ACTIVE');
$$;

revoke all on all functions in schema app from public;
grant execute on function
  app.current_user_id(), app.is_platform_admin(), app.current_membership(uuid), app.is_member(uuid),
  app.has_permission(uuid, text), app.has_branch_access(uuid, uuid), app.tenant_is_public(uuid)
to authenticated, anon, service_role;
