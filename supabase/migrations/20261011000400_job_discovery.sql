begin;

create table public.gmail_connections (
  owner_id uuid primary key references jobpilot_private.owner_registration(user_id) on delete restrict,
  expected_email text not null check (length(expected_email) <= 254 and expected_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  connected_email text,
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'reconnect_required')),
  generation uuid not null default gen_random_uuid(),
  checked_at timestamptz,
  error_code text
);
create table public.gmail_credentials (
  owner_id uuid primary key references public.gmail_connections(owner_id) on delete cascade,
  encrypted_refresh_token text not null,
  generation uuid not null
);
create table public.gmail_oauth_states (
  owner_id uuid primary key references public.gmail_connections(owner_id) on delete cascade,
  state_hash text not null unique,
  verifier text not null,
  generation uuid not null,
  expected_email text not null,
  expires_at timestamptz not null
);

create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references jobpilot_private.owner_registration(user_id) on delete restrict,
  kind text not null check (kind in ('manual', 'gmail', 'greenhouse')),
  source_key text not null check (length(source_key) between 1 and 200),
  name text not null check (length(name) between 1 and 200),
  enabled boolean not null default true,
  cursor text,
  last_success_at timestamptz,
  unique (owner_id, kind, source_key),
  unique (id, owner_id),
  check (kind <> 'greenhouse' or source_key ~ '^[a-zA-Z0-9_-]{1,100}$')
);
create unique index one_gmail_source on public.job_sources(owner_id) where kind = 'gmail';
create unique index one_manual_source on public.job_sources(owner_id) where kind = 'manual';
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references jobpilot_private.owner_registration(user_id) on delete restrict,
  source_id uuid not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  imported_count integer not null default 0 check (imported_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  error_code text,
  foreign key (source_id, owner_id) references public.job_sources(id, owner_id)
);
create unique index one_running_import on public.import_runs(source_id) where status = 'running';
create index import_runs_owner_started on public.import_runs(owner_id, started_at desc);
create table public.imported_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references jobpilot_private.owner_registration(user_id) on delete restrict,
  title text check (length(title) <= 500),
  company text check (length(company) <= 500),
  location text check (length(location) <= 500),
  work_mode text check (work_mode in ('remote', 'hybrid', 'on-site')),
  description text not null check (length(description) <= 50000),
  canonical_url text check (length(canonical_url) <= 2048 and canonical_url ~ '^https?://'),
  requirements text[] not null default '{}',
  uncertainty text[] not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index jobs_canonical_url on public.imported_jobs(owner_id, canonical_url) where canonical_url is not null;
create index jobs_owner_created on public.imported_jobs(owner_id, created_at desc);
create table public.job_origins (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references jobpilot_private.owner_registration(user_id) on delete restrict,
  job_id uuid not null,
  source_id uuid not null,
  external_id text not null check (length(external_id) between 1 and 2500),
  message_id text,
  sender text,
  source_date timestamptz,
  source_url text,
  foreign key (job_id, owner_id) references public.imported_jobs(id, owner_id),
  foreign key (source_id, owner_id) references public.job_sources(id, owner_id),
  unique (source_id, external_id)
);
create index origins_job on public.job_origins(job_id);
create table public.job_reviews (
  owner_id uuid not null references jobpilot_private.owner_registration(user_id) on delete restrict,
  job_id uuid primary key,
  disposition text not null default 'new' check (disposition in ('new', 'saved', 'dismissed')),
  reviewed boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key (job_id, owner_id) references public.imported_jobs(id, owner_id)
);

do $$
declare t text;
begin
  foreach t in array array['gmail_connections','job_sources','import_runs','imported_jobs','job_origins','job_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()))', t);
  end loop;
  foreach t in array array['gmail_credentials','gmail_oauth_states'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant insert (owner_id, job_id, disposition, reviewed), update (disposition, reviewed) on public.job_reviews to authenticated;
create policy owner_insert on public.job_reviews for insert to authenticated
with check ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));
create policy owner_update on public.job_reviews for update to authenticated
using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()))
with check ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));
create trigger stamp_review before update on public.job_reviews for each row execute function jobpilot_private.stamp_profile();

create function public.phase3_is_owner(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from jobpilot_private.owner_registration where user_id = p_owner);
$$;
create function public.set_gmail_label(p_owner uuid, p_label text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 1));
  select id into s from public.job_sources where owner_id = p_owner and kind = 'gmail' for update;
  if s is not null then
    if exists(select 1 from public.import_runs where source_id = s and status = 'running' and started_at > now() - interval '5 minutes') then raise exception 'Import busy'; end if;
    update public.job_sources set source_key = p_label, name = p_name, cursor = null, enabled = true, last_success_at = null where id = s;
  else
    insert into public.job_sources(owner_id, kind, source_key, name) values(p_owner, 'gmail', p_label, p_name);
  end if;
end $$;

create function public.begin_gmail_oauth(p_owner uuid, p_email text, p_hash text, p_verifier text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g uuid := gen_random_uuid();
begin
  if not exists (select 1 from jobpilot_private.owner_registration where user_id = p_owner) then raise exception 'Owner access required' using errcode = '42501'; end if;
  -- Label IDs belong to a mailbox. A different account must explicitly reconfirm its label.
  if exists(select 1 from public.gmail_connections where owner_id = p_owner and expected_email <> p_email) then
    update public.job_sources set enabled = false, cursor = null, last_success_at = null where owner_id = p_owner and kind = 'gmail';
  end if;
  insert into public.gmail_connections(owner_id, expected_email, generation) values(p_owner, p_email, g)
  on conflict(owner_id) do update set expected_email = excluded.expected_email, generation = g,
    status = 'disconnected', connected_email = null, checked_at = null, error_code = null;
  delete from public.gmail_credentials where owner_id = p_owner;
  insert into public.gmail_oauth_states values(p_owner, p_hash, p_verifier, g, p_email, now() + interval '10 minutes')
  on conflict(owner_id) do update set state_hash = excluded.state_hash, verifier = excluded.verifier, generation = g,
    expected_email = p_email, expires_at = excluded.expires_at;
  return g;
end $$;
create function public.consume_gmail_state(p_hash text) returns setof public.gmail_oauth_states
language sql security definer set search_path = '' as $$
  delete from public.gmail_oauth_states s using public.gmail_connections c, jobpilot_private.owner_registration o
  where s.state_hash = p_hash and s.expires_at > now() and s.owner_id = c.owner_id
    and s.generation = c.generation and o.user_id = s.owner_id returning s.*;
$$;
create function public.finish_gmail_oauth(p_owner uuid, p_generation uuid, p_email text, p_encrypted text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.gmail_connections where owner_id = p_owner and generation = p_generation
    and expected_email = p_email for update;
  if not found then return false; end if;
  insert into public.gmail_credentials values(p_owner, p_encrypted, p_generation)
  on conflict(owner_id) do update set encrypted_refresh_token = excluded.encrypted_refresh_token, generation = excluded.generation;
  update public.gmail_connections set status = 'connected', connected_email = p_email, checked_at = now(), error_code = null where owner_id = p_owner;
  return true;
end $$;
create function public.disconnect_gmail(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.gmail_connections set status = 'disconnected', generation = gen_random_uuid(), connected_email = null, checked_at = null, error_code = null where owner_id = p_owner;
  delete from public.gmail_credentials where owner_id = p_owner;
  delete from public.gmail_oauth_states where owner_id = p_owner;
end $$;

create function public.start_job_import(p_owner uuid, p_source uuid) returns public.import_runs
language plpgsql security definer set search_path = '' as $$
declare r public.import_runs;
begin
  perform 1 from public.job_sources where id = p_source and owner_id = p_owner and enabled and kind <> 'manual' for update;
  if not found then raise exception 'Source unavailable'; end if;
  update public.import_runs set status = 'failed', error_code = 'interrupted', finished_at = now()
    where source_id = p_source and status = 'running' and started_at < now() - interval '5 minutes';
  insert into public.import_runs(owner_id, source_id) values(p_owner, p_source) returning * into r;
  return r;
end $$;
create function public.finish_job_import(p_owner uuid, p_run uuid, p_error text, p_cursor text, p_added integer, p_duplicates integer) returns void
language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  update public.import_runs set status = case when p_error is null then 'succeeded' else 'failed' end,
    error_code = p_error, imported_count = p_added, duplicate_count = p_duplicates, finished_at = now()
    where id = p_run and owner_id = p_owner and status = 'running' returning source_id into s;
  if s is not null and p_error is null then
    update public.job_sources set cursor = p_cursor, last_success_at = now() where id = s;
  end if;
end $$;
create function public.store_job_candidate(p_owner uuid, p_source uuid, p_external text, p_job jsonb, p_origin jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j uuid; added boolean := false;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 0));
  if not exists (select 1 from public.job_sources where id = p_source and owner_id = p_owner) then raise exception 'Source unavailable'; end if;
  if exists (select 1 from public.job_origins where source_id = p_source and external_id = p_external) then return false; end if;
  if p_job->>'canonical_url' is not null then
    select id into j from public.imported_jobs where owner_id = p_owner and canonical_url = p_job->>'canonical_url';
  end if;
  if j is null then
    insert into public.imported_jobs(owner_id, title, company, location, work_mode, description, canonical_url, requirements, uncertainty, published_at)
    values(p_owner, p_job->>'title', p_job->>'company', p_job->>'location', p_job->>'work_mode', p_job->>'description', p_job->>'canonical_url',
      array(select jsonb_array_elements_text(p_job->'requirements')), array(select jsonb_array_elements_text(p_job->'uncertainty')), (p_job->>'published_at')::timestamptz)
    returning id into j;
    insert into public.job_reviews(owner_id, job_id) values(p_owner, j);
    added := true;
  end if;
  insert into public.job_origins(owner_id, job_id, source_id, external_id, message_id, sender, source_date, source_url)
    values(p_owner, j, p_source, p_external, p_origin->>'message_id', p_origin->>'sender', (p_origin->>'source_date')::timestamptz, p_origin->>'source_url');
  return added;
end $$;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array['phase3_is_owner','set_gmail_label','begin_gmail_oauth','consume_gmail_state','finish_gmail_oauth','disconnect_gmail','start_job_import','finish_job_import','store_job_candidate']) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
commit;
