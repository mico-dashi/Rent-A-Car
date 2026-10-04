-- =====================================================================
-- 0014 SESSION RPCs for UIs: caller's memberships and effective
-- permissions (UI affordances only — enforcement stays in RLS/RPCs).
-- =====================================================================
create or replace function public.my_memberships()
returns table (tenant_id uuid, tenant_slug text, tenant_name text, tenant_status public.tenant_status,
               role public.role_key, branch_ids uuid[], permissions text[])
language sql stable security definer set search_path = '' as $$
  select m.tenant_id, t.slug, t.display_name, t.status, m.role, m.branch_ids,
         array(select p.key from public.permissions p
               where app.user_has_permission(auth.uid(), m.tenant_id, p.key) order by p.key)
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'ACTIVE' and t.status <> 'ARCHIVED'
  order by t.display_name;
$$;

create or replace function public.am_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select app.is_platform_admin() $$;

revoke all on function public.my_memberships(), public.am_platform_admin() from public, anon;
grant execute on function public.my_memberships(), public.am_platform_admin() to authenticated;

-- Webhook bookkeeping helper (service role only).
create or replace function public.increment_webhook_attempts(p_provider text, p_event_id text) returns void
language sql security definer set search_path = '' as $$
  update public.webhook_events set attempts = attempts + 1 where provider = p_provider and event_id = p_event_id;
$$;
revoke all on function public.increment_webhook_attempts(text, text) from public, anon, authenticated;
grant execute on function public.increment_webhook_attempts(text, text) to service_role;

-- Public legal documents for a storefront (tenant_settings itself is staff-only).
create or replace function public.tenant_legal_documents(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('terms', s.legal_terms_md, 'privacy', s.legal_privacy_md, 'version', s.legal_policy_version)
  from public.tenant_settings s where s.tenant_id = p_tenant and app.tenant_is_public(p_tenant);
$$;
grant execute on function public.tenant_legal_documents(uuid) to anon, authenticated, service_role;
