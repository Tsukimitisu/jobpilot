begin;

do $$
declare
  requested_owner uuid := 'REPLACE_WITH_EXISTING_AUTH_USER_UUID';
  existing_owner uuid;
begin
  lock table jobpilot_private.owner_registration in exclusive mode;
  if not exists (select 1 from auth.users where id = requested_owner) then
    raise exception 'Bootstrap refused: UUID does not identify an existing Supabase Auth user';
  end if;
  select user_id into existing_owner from jobpilot_private.owner_registration where singleton;
  if existing_owner is not null and existing_owner <> requested_owner then
    raise exception 'Bootstrap refused: a different JobPilot owner is already registered';
  end if;
  insert into jobpilot_private.owner_registration(singleton, user_id)
  values (true, requested_owner) on conflict (singleton) do nothing;
end;
$$;

select user_id, registered_at from jobpilot_private.owner_registration;
commit;
