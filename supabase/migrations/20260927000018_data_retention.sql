-- Data retention: enforce tenant_settings.data_retention_days.
--
-- Run by the scheduler (service role) through public.apply_data_retention().
-- Per tenant, once a customer has had no rental activity for longer than the
-- tenant's retention period and nothing is still open or owed, their personal
-- data is anonymised and their identity documents and messages are deleted.
-- Inspection photos of long-finished bookings without open damage cases are
-- removed too. Kept on purpose: invoices (tax law), booking and payment
-- records (amounts only, linked to the anonymised customer) and the audit log.
--
-- The function returns the storage objects whose rows it deleted; the caller
-- removes those files (storage cannot be reached from SQL safely).

alter table public.customers add column if not exists anonymized_at timestamptz;

create or replace function public.apply_data_retention(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_files jsonb := '[]'::jsonb;
  v_customers integer := 0;
  v_photos integer := 0;
  v_threads integer := 0;
  v_notifications integer := 0;
begin
  if not app.is_service_call() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;

  -- 1. Inactive customers past retention, with every booking final, settled and without open damage.
  for r in
    select c.id, c.tenant_id
      from public.customers c
      join public.tenant_settings s on s.tenant_id = c.tenant_id
     where c.anonymized_at is null
       and c.created_at < now() - make_interval(days => s.data_retention_days)
       and coalesce((select max(b.ends_at) from public.bookings b where b.customer_id = c.id), c.created_at)
             < now() - make_interval(days => s.data_retention_days)
       and not exists (
         select 1 from public.bookings b
          where b.customer_id = c.id
            and (b.status not in ('COMPLETED', 'CANCELLED', 'NO_SHOW')
                 or b.payment_status in ('UNPAID', 'PARTIALLY_PAID') and b.status = 'COMPLETED' and b.total_minor > 0
                 or exists (select 1 from public.vehicle_damages d
                             where d.booking_id = b.id and d.status not in ('REPAIRED', 'CLOSED'))))
     order by c.created_at
     limit p_limit
  loop
    v_files := v_files
      || coalesce((select jsonb_agg(jsonb_build_object('bucket', 'customer-documents', 'path', p))
                     from public.driver_licenses l, unnest(array[l.front_image_path, l.back_image_path]) p
                    where l.customer_id = r.id and p is not null), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('bucket', 'customer-documents', 'path', d.storage_path))
                     from public.customer_documents d where d.customer_id = r.id), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('bucket', 'message-attachments', 'path', p))
                     from public.messages m join public.message_threads t on t.id = m.thread_id, unnest(m.attachment_paths) p
                    where t.customer_id = r.id), '[]'::jsonb);

    delete from public.driver_licenses where customer_id = r.id;
    delete from public.customer_documents where customer_id = r.id;
    with gone as (delete from public.message_threads where customer_id = r.id returning id)
    select v_threads + count(*) into v_threads from gone;           -- messages cascade with their thread
    update public.customer_restrictions set reason = '[removed by retention policy]' where customer_id = r.id;
    update public.customers set first_name = 'Deleted', last_name = 'Customer', email = 'deleted+' || id || '@invalid.example',
      phone = null, date_of_birth = null, address_line1 = null, address_line2 = null, city = null, postal_code = null,
      nationality = null, emergency_contact_name = null, emergency_contact_phone = null, identity_provider_ref = null,
      preferences = '{}', marketing_opt_in = false, user_id = null, anonymized_at = now()
     where id = r.id;
    v_customers := v_customers + 1;
  end loop;

  -- 2. Inspection photos of bookings that ended before the retention cutoff, with no open damage case.
  for r in
    select p.id, p.storage_path
      from public.inspection_photos p
      join public.vehicle_inspections i on i.id = p.inspection_id
      join public.bookings b on b.id = i.booking_id
      join public.tenant_settings s on s.tenant_id = b.tenant_id
     where b.ends_at < now() - make_interval(days => s.data_retention_days)
       and b.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW')
       and not exists (select 1 from public.vehicle_damages d where d.booking_id = b.id and d.status not in ('REPAIRED', 'CLOSED'))
     limit p_limit * 10
  loop
    v_files := v_files || jsonb_build_array(jsonb_build_object('bucket', 'inspection-photos', 'path', r.storage_path));
    delete from public.inspection_photos where id = r.id;
    v_photos := v_photos + 1;
  end loop;

  -- 3. Delivered or failed notifications are operational data: keep 180 days.
  with gone as (
    delete from public.notifications
     where id in (select id from public.notifications
                   where status in ('SENT', 'DELIVERED', 'READ', 'FAILED') and created_at < now() - interval '180 days'
                   limit p_limit * 50)
    returning 1)
  select count(*) into v_notifications from gone;

  return jsonb_build_object('customers', v_customers, 'photos', v_photos, 'threads', v_threads,
                            'notifications', v_notifications, 'files', v_files);
end $$;

revoke all on function public.apply_data_retention(integer) from public, anon, authenticated;
grant execute on function public.apply_data_retention(integer) to service_role;
