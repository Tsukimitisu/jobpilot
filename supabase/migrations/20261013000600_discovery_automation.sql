begin;

-- Bind label confirmation to the mailbox, including across reconnects.
alter table public.job_sources add column confirmed_email text;
update public.job_sources s set confirmed_email = c.expected_email from public.gmail_connections c
  where s.owner_id = c.owner_id and s.kind = 'gmail' and s.enabled;
create function jobpilot_private.invalidate_label_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.expected_email <> new.expected_email then
    update public.job_sources set confirmed_email = null, enabled = false, cursor = null where owner_id = new.owner_id and kind = 'gmail';
  end if;
  return new;
end $$;
revoke all on function jobpilot_private.invalidate_label_confirmation() from public, anon, authenticated;
create trigger invalidate_label_confirmation after update of expected_email on public.gmail_connections
  for each row execute function jobpilot_private.invalidate_label_confirmation();
create or replace function public.set_gmail_label(p_owner uuid, p_label text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare s uuid; email text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 1));
  select expected_email into email from public.gmail_connections where owner_id = p_owner;
  select id into s from public.job_sources where owner_id = p_owner and kind = 'gmail' for update;
  if s is not null then
    if exists(select 1 from public.import_runs where source_id = s and status = 'running' and started_at > now() - interval '5 minutes') then raise exception 'Import busy'; end if;
    update public.job_sources set source_key = p_label, name = p_name, cursor = null, enabled = true, last_success_at = null, confirmed_email = email where id = s;
  else
    insert into public.job_sources(owner_id, kind, source_key, name, confirmed_email) values(p_owner, 'gmail', p_label, p_name, email);
  end if;
end $$;

create table public.discovery_automation (
  owner_id uuid primary key references jobpilot_private.owner_registration(user_id) on delete restrict,
  enabled boolean not null default false,
  next_run_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.discovery_automation(owner_id),
  started_at timestamptz not null default now(),
  lease_until timestamptz not null default now() + interval '3 minutes',
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','partial','failed','paused')),
  error_code text,
  results jsonb not null default '[]'::jsonb
);
create unique index one_running_automation on public.automation_runs(owner_id) where status = 'running';
create index automation_owner_started on public.automation_runs(owner_id, started_at desc);
alter table public.import_runs add column automation_run_id uuid references public.automation_runs(id);
create index imports_automation_run on public.import_runs(automation_run_id) where automation_run_id is not null;
create index imports_source_started on public.import_runs(source_id, started_at desc);

-- Retain a result for every source even when the recent-history window has moved on.
create view public.latest_scheduled_imports with (security_invoker = true) as
  select distinct on (source_id) * from public.import_runs where automation_run_id is not null
  order by source_id, started_at desc, id desc;
revoke all on public.latest_scheduled_imports from public, anon, authenticated;
grant select on public.latest_scheduled_imports to authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['discovery_automation','automation_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()))', t);
  end loop;
end $$;

-- No owner bootstrap and no hosted Cron mutation in this migration.
create function public.set_discovery_automation(p_owner uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.phase3_is_owner(p_owner) or p_enabled is null then raise exception 'Owner access required'; end if;
  insert into public.discovery_automation(owner_id) values(p_owner) on conflict do nothing;
  perform 1 from public.discovery_automation where owner_id = p_owner for update;
  update public.discovery_automation set enabled = p_enabled, updated_at = now(),
    next_run_at = case when not p_enabled then null when enabled then next_run_at else date_trunc('hour', now()) + interval '1 hour' end
    where owner_id = p_owner;
  if not p_enabled then
    update public.import_runs i set status = 'failed', error_code = 'automation_paused', finished_at = now()
      from public.automation_runs a where i.automation_run_id = a.id and a.owner_id = p_owner and a.status = 'running' and i.status = 'running';
    update public.automation_runs set status = 'paused', error_code = 'automation_paused', finished_at = now()
      where owner_id = p_owner and status = 'running';
  end if;
end $$;

-- The scheduler cannot supply an owner. Registration is the authority.
create function public.claim_discovery_automation() returns public.automation_runs
language plpgsql security definer set search_path = '' as $$
declare o uuid; s public.discovery_automation; r public.automation_runs;
begin
  select user_id into o from jobpilot_private.owner_registration;
  select * into s from public.discovery_automation where owner_id = o for update;
  if not found then return null; end if;
  update public.import_runs i set status = 'failed', error_code = 'interrupted', finished_at = now()
    from public.automation_runs a where i.automation_run_id = a.id and i.status = 'running'
      and a.owner_id = o and a.status = 'running' and a.lease_until <= now();
  update public.automation_runs set status = 'failed', error_code = 'interrupted', finished_at = now()
    where owner_id = o and status = 'running' and lease_until <= now();
  if not s.enabled or s.next_run_at > now() or s.next_run_at is null or
    exists(select 1 from public.automation_runs where owner_id = o and status = 'running') then return null; end if;
  insert into public.automation_runs(owner_id) values(o) returning * into r;
  update public.discovery_automation set next_run_at = date_trunc('hour', now()) + interval '1 hour' where owner_id = o;
  return r;
end $$;

-- Oldest attempted sources first prevents a failing first source starving later boards.
create function public.scheduled_discovery_sources(p_run uuid) returns setof public.job_sources
language sql security definer set search_path = '' as $$
  select s.* from public.job_sources s join public.automation_runs a on a.owner_id = s.owner_id
  join public.discovery_automation c on c.owner_id = a.owner_id
  where a.id = p_run and a.status = 'running' and a.lease_until > now() and c.enabled
    and s.enabled and s.kind in ('gmail','greenhouse')
  order by (select max(i.started_at) from public.import_runs i where i.source_id = s.id) asc nulls first, s.id
  limit 3;
$$;

create function public.discovery_automation_active(p_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.automation_runs a join public.discovery_automation c on c.owner_id = a.owner_id
    where a.id = p_run and a.status = 'running' and a.lease_until > now() and c.enabled);
$$;

create function public.start_scheduled_import(p_run uuid, p_source uuid) returns public.import_runs
language plpgsql security definer set search_path = '' as $$
declare a public.automation_runs; r public.import_runs;
begin
  select * into a from public.automation_runs where id = p_run;
  perform 1 from public.discovery_automation where owner_id = a.owner_id and enabled for update;
  if not found or not public.discovery_automation_active(p_run) then raise exception 'Schedule paused or expired'; end if;
  r := public.start_job_import(a.owner_id, p_source);
  update public.import_runs set automation_run_id = p_run where id = r.id returning * into r;
  return r;
end $$;

-- Fence delayed workers before every write. Pauses/disabled sources stop future writes;
-- a request already dispatched to the read-only provider may complete.
create function public.store_import_candidate(p_owner uuid, p_run uuid, p_external text, p_job jsonb, p_origin jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.import_runs; fresh boolean;
begin
  select * into r from public.import_runs where id = p_run and owner_id = p_owner;
  if r.automation_run_id is not null then
    perform 1 from public.discovery_automation c join public.automation_runs a on a.owner_id = c.owner_id
      where c.owner_id = p_owner and c.enabled and a.id = r.automation_run_id and a.status = 'running' and a.lease_until > now() for update of c;
    if not found then raise exception 'Schedule paused or expired'; end if;
  end if;
  perform 1 from public.job_sources where id = r.source_id and owner_id = p_owner and enabled for update;
  if not found then raise exception 'Source unavailable'; end if;
  perform 1 from public.import_runs where id = p_run and status = 'running' and started_at > now() - interval '5 minutes' for update;
  if not found then raise exception 'Import expired'; end if;
  fresh := public.store_job_candidate(p_owner, r.source_id, p_external, p_job, p_origin);
  update public.import_runs set imported_count = imported_count + case when fresh then 1 else 0 end,
    duplicate_count = duplicate_count + case when fresh then 0 else 1 end where id = p_run;
  return fresh;
end $$;

create function public.finish_discovery_automation(p_run uuid, p_status text, p_error text, p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.automation_runs set status = p_status, error_code = p_error, results = p_results, finished_at = now()
    where id = p_run and status = 'running' and lease_until > now();
end $$;

create or replace function public.finish_job_import(p_owner uuid, p_run uuid, p_error text, p_cursor text, p_added integer, p_duplicates integer) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.import_runs; e text := p_error;
begin
  select * into r from public.import_runs where id = p_run and owner_id = p_owner;
  if not found then return; end if;
  if r.automation_run_id is not null then
    perform 1 from public.discovery_automation c join public.automation_runs a on a.owner_id = c.owner_id
      where c.owner_id = p_owner and c.enabled and a.id = r.automation_run_id and a.status = 'running' and a.lease_until > now() for update of c;
    if not found then e := coalesce(e, 'automation_paused'); end if;
  end if;
  perform 1 from public.job_sources where id = r.source_id and enabled for update;
  if not found then e := coalesce(e, 'source_paused'); end if;
  if r.started_at <= now() - interval '5 minutes' then e := coalesce(e, 'interrupted'); end if;
  update public.import_runs set status = case when e is null then 'succeeded' else 'failed' end,
    error_code = e, imported_count = greatest(imported_count, p_added), duplicate_count = greatest(duplicate_count, p_duplicates), finished_at = now()
    where id = p_run and owner_id = p_owner and status = 'running';
  if found and e is null then
    update public.job_sources set cursor = p_cursor, last_success_at = now() where id = r.source_id;
  end if;
end $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array['set_discovery_automation','claim_discovery_automation','scheduled_discovery_sources','discovery_automation_active','start_scheduled_import','store_import_candidate','finish_discovery_automation']) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
commit;
