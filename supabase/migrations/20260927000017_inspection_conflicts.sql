-- Report stale offline inspection edits as a business error instead of
-- SQLSTATE 40001: PostgREST treats 40001 as a serialization failure and
-- retries the request, so a genuine version conflict would retry until the
-- client times out instead of reaching the device's conflict handling.
create or replace function app.guard_inspection_update() returns trigger
language plpgsql as $$
begin
  if old.status = 'LOCKED' then
    raise exception 'BOOKING_NOT_MODIFIABLE' using errcode = 'P0001', detail = 'inspection locked';
  end if;
  if new.version <> old.version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001',
      detail = format('server version %s, client version %s', old.version, new.version);
  end if;
  new.version := old.version + 1;
  return new;
end $$;
