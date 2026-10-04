-- Universal app: "rental companies near me".
--
-- Returns ACTIVE tenants that have location discovery enabled (per-tenant flag
-- or plan feature, falling back to the platform default) with their nearest
-- active branch inside the radius. Only public storefront information is
-- returned. The caller's coordinates are used for the query and never stored.

create or replace function public.nearby_tenants(p_lat double precision, p_lng double precision, p_radius_km integer default 50, p_limit integer default 20)
returns table (slug text, display_name text, logo_path text, primary_color text, branch_name text, city text, distance_km numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  return query
  with candidates as (
    select t.id, t.slug::text as slug, t.display_name::text as display_name, br.name::text as branch_name, br.city::text as city,
           -- haversine, km
           2 * 6371 * asin(sqrt(
             power(sin(radians((br.latitude::double precision - p_lat) / 2)), 2)
             + cos(radians(p_lat)) * cos(radians(br.latitude::double precision))
               * power(sin(radians((br.longitude::double precision - p_lng) / 2)), 2))) as km
      from public.tenants t
      join public.branches br on br.tenant_id = t.id
     where t.status = 'ACTIVE'
       and br.is_active and br.latitude is not null and br.longitude is not null
       -- cheap bounding box before the exact distance (1 degree latitude ~ 111 km)
       and br.latitude between p_lat - least(greatest(p_radius_km, 1), 200) / 111.0 and p_lat + least(greatest(p_radius_km, 1), 200) / 111.0
       and app.feature_enabled(t.id, 'location_discovery')
  ), nearest as (
    select distinct on (c.id) c.* from candidates c
     where c.km <= least(greatest(p_radius_km, 1), 200)
     order by c.id, c.km
  )
  select n.slug, n.display_name, b.logo_path::text, b.primary_color::text, n.branch_name, n.city, round(n.km::numeric, 1)
    from nearest n
    left join public.tenant_branding b on b.tenant_id = n.id
   order by n.km
   limit least(greatest(p_limit, 1), 50);
end $$;

revoke all on function public.nearby_tenants(double precision, double precision, integer, integer) from public;
grant execute on function public.nearby_tenants(double precision, double precision, integer, integer) to anon, authenticated, service_role;
