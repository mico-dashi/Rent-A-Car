-- =====================================================================
-- 0012 STORAGE BUCKETS & POLICIES
-- Path convention: <tenant_id>/<...>. Sensitive buckets are private and
-- are only ever served through short-lived signed URLs.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('vehicle-media', 'vehicle-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4']),
  ('tenant-branding', 'tenant-branding', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('customer-documents', 'customer-documents', false, 10485760, array['image/jpeg', 'image/png', 'image/heic', 'application/pdf']),
  ('inspection-photos', 'inspection-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/heic', 'image/webp']),
  ('vehicle-documents', 'vehicle-documents', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png']),
  ('documents', 'documents', false, 20971520, array['application/pdf', 'image/png']),
  ('message-attachments', 'message-attachments', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function app.path_tenant(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end $$;
create or replace function app.path_segment(p_name text, p_index integer) returns text
language sql immutable as $$ select (storage.foldername(p_name))[p_index] $$;
grant execute on function app.path_tenant(text), app.path_segment(text, integer) to anon, authenticated, service_role;

-- Public marketing media: world-readable; writes by fleet/branding managers.
create policy "vehicle media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-media' and app.has_permission(app.path_tenant(name), 'vehicles.write'));
create policy "vehicle media update" on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-media' and app.has_permission(app.path_tenant(name), 'vehicles.write'));
create policy "vehicle media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-media' and app.has_permission(app.path_tenant(name), 'vehicles.write'));

create policy "branding write" on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-branding' and app.has_permission(app.path_tenant(name), 'branding.manage'));
create policy "branding update" on storage.objects for update to authenticated
  using (bucket_id = 'tenant-branding' and app.has_permission(app.path_tenant(name), 'branding.manage'));
create policy "branding delete" on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-branding' and app.has_permission(app.path_tenant(name), 'branding.manage'));

-- Customer identity documents: <tenant>/<customer_id>/<file>
create policy "customer docs own read" on storage.objects for select to authenticated
  using (bucket_id = 'customer-documents' and app.owns_customer(app.path_segment(name, 2)::uuid));
create policy "customer docs own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-documents' and app.owns_customer(app.path_segment(name, 2)::uuid)
              and exists (select 1 from public.customers c where c.id = app.path_segment(name, 2)::uuid
                          and c.tenant_id = app.path_tenant(name)));
create policy "customer docs staff read" on storage.objects for select to authenticated
  using (bucket_id = 'customer-documents' and app.has_permission(app.path_tenant(name), 'customers.documents'));

-- Inspection photos: <tenant>/<inspection_id>/<file>
create policy "inspection photos staff read" on storage.objects for select to authenticated
  using (bucket_id = 'inspection-photos' and (app.has_permission(app.path_tenant(name), 'inspections.perform')
                                              or app.has_permission(app.path_tenant(name), 'damages.read')));
create policy "inspection photos staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'inspection-photos' and app.has_permission(app.path_tenant(name), 'inspections.perform'));
create policy "inspection photos customer read" on storage.objects for select to authenticated
  using (bucket_id = 'inspection-photos' and exists (
    select 1 from public.vehicle_inspections i where i.id = app.path_segment(name, 2)::uuid
      and i.tenant_id = app.path_tenant(name) and i.booking_id is not null and app.owns_booking(i.booking_id)));

create policy "vehicle docs staff" on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-documents' and app.has_permission(app.path_tenant(name), 'vehicles.read'));
create policy "vehicle docs write" on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-documents' and app.has_permission(app.path_tenant(name), 'vehicles.write'));

-- Agreements, invoices, signatures: written by server only; read via signed URL
-- issued after an authorization check, or directly by staff with bookings.read.
create policy "documents staff read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and app.has_permission(app.path_tenant(name), 'bookings.read'));

create policy "message attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'message-attachments' and (
    app.has_permission(app.path_tenant(name), 'messages.read')
    or exists (select 1 from public.message_threads t where t.id = app.path_segment(name, 2)::uuid
               and t.tenant_id = app.path_tenant(name) and app.owns_customer(t.customer_id))));
create policy "message attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'message-attachments' and (
    app.has_permission(app.path_tenant(name), 'messages.write')
    or exists (select 1 from public.message_threads t where t.id = app.path_segment(name, 2)::uuid
               and t.tenant_id = app.path_tenant(name) and app.owns_customer(t.customer_id))));
