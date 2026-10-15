begin;

create function jobpilot_private.valid_search_list(items text[]) returns boolean language sql immutable set search_path='' as $$
  select items is not null and cardinality(items)<=20 and not exists(select 1 from unnest(items) item where item is null or length(trim(item)) not between 1 and 100);
$$;
revoke all on function jobpilot_private.valid_search_list(text[]) from public,anon,authenticated;
grant execute on function jobpilot_private.valid_search_list(text[]) to service_role;

create table public.search_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references jobpilot_private.owner_registration(user_id),
  name text not null check (length(trim(name)) between 1 and 100),
  desired_titles text[] not null check (cardinality(desired_titles) between 1 and 20 and jobpilot_private.valid_search_list(desired_titles)),
  alternative_titles text[] not null default '{}' check (jobpilot_private.valid_search_list(alternative_titles)),
  required_keywords text[] not null default '{}' check (jobpilot_private.valid_search_list(required_keywords)),
  excluded_keywords text[] not null default '{}' check (jobpilot_private.valid_search_list(excluded_keywords)),
  locations text[] not null default '{}' check (jobpilot_private.valid_search_list(locations)),
  work_modes text[] not null default '{}' check (work_modes <@ array['remote','hybrid','on-site']),
  employment_types text[] not null default '{}' check (employment_types <@ array['full-time','part-time','contract','temporary','internship','permanent']),
  max_experience integer check (max_experience between 0 and 50),
  minimum_salary numeric check (minimum_salary between 0 and 10000000),
  results_limit integer not null default 20 check (results_limit between 1 and 50),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(owner_id, name)
);
create index search_profiles_enabled on public.search_profiles(owner_id, id) where enabled;
create trigger stamp_search_profile before update on public.search_profiles for each row execute function jobpilot_private.stamp_profile();
alter table public.search_profiles enable row level security;
revoke all on public.search_profiles from public, anon, authenticated;
grant select on public.search_profiles to authenticated;
grant all on public.search_profiles to service_role;
create policy owner_read on public.search_profiles for select to authenticated using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));

create function jobpilot_private.limit_search_profiles() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,6));
  if (select count(*) from public.search_profiles where owner_id=new.owner_id)>=20 then raise exception 'Search profile limit reached'; end if;
  return new;
end $$;
revoke all on function jobpilot_private.limit_search_profiles() from public,anon,authenticated;
create trigger limit_search_profiles before insert on public.search_profiles for each row execute function jobpilot_private.limit_search_profiles();

alter table public.job_sources drop constraint job_sources_kind_check;
alter table public.job_sources add constraint job_sources_kind_check check (kind in ('manual','gmail','greenhouse','lever','ashby','adzuna'));
alter table public.job_sources add constraint board_identifier check (kind not in ('greenhouse','lever','ashby') or source_key ~ '^[a-zA-Z0-9_-]{1,100}$');
alter table public.job_sources add column removed_at timestamptz;
alter table public.job_sources add column next_eligible_at timestamptz;
alter table public.job_sources add column failure_count integer not null default 0;
alter table public.job_sources add column last_attempted_at timestamptz;
alter table public.job_sources add column last_error_code text;
alter table public.job_sources add column last_added integer not null default 0;
alter table public.job_sources add column last_duplicates integer not null default 0;
create index discovery_eligible on public.job_sources(owner_id, next_eligible_at, last_attempted_at) where enabled and removed_at is null;
-- Existing configured sources retain their state. New connectors cannot start enabled.
create function jobpilot_private.new_source_disabled() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind in ('lever','ashby','adzuna') then new.enabled := false; end if;
  return new;
end $$;
create trigger new_source_disabled before insert on public.job_sources for each row execute function jobpilot_private.new_source_disabled();
revoke all on function jobpilot_private.new_source_disabled() from public, anon, authenticated;

alter table public.imported_jobs add column fingerprint text;
alter table public.imported_jobs add column employment_type text;
alter table public.imported_jobs add column experience_years integer check (experience_years between 0 and 80);
alter table public.imported_jobs add column salary_min numeric check (salary_min >= 0);
alter table public.imported_jobs add column salary_currency text;
alter table public.imported_jobs add column salary_period text;
alter table public.imported_jobs add column profile_matches jsonb not null default '[]';
alter table public.job_origins add column provider text;
alter table public.job_origins add column provider_external_id text;
alter table public.job_origins add column direct_url text;
alter table public.job_origins add column parsing_confidence text check (parsing_confidence in ('high','medium','low'));
create index origins_provider_identity on public.job_origins(owner_id, provider, provider_external_id) where provider_external_id is not null;
create index origins_direct_url on public.job_origins(owner_id,direct_url) where direct_url is not null;

create function jobpilot_private.job_fingerprint(company text, title text, location text, description text) returns text
language sql immutable set search_path = '' as $$
  select case when length(trim(company)) > 0 and length(trim(title)) > 0 and length(trim(location)) > 0 and length(trim(description)) >= 40
    then encode(sha256(convert_to(lower(jsonb_build_array(
      regexp_replace(trim(company),'\s+',' ','g'),regexp_replace(trim(title),'\s+',' ','g'),
      regexp_replace(trim(location),'\s+',' ','g'),regexp_replace(trim(description),'\s+',' ','g'))::text), 'UTF8')), 'hex') end;
$$;
revoke all on function jobpilot_private.job_fingerprint(text,text,text,text) from public, anon, authenticated;
update public.imported_jobs set fingerprint = jobpilot_private.job_fingerprint(company,title,location,description);
create index jobs_fingerprint on public.imported_jobs(owner_id,fingerprint) where fingerprint is not null;

create or replace function public.store_job_candidate(p_owner uuid, p_source uuid, p_external text, p_job jsonb, p_origin jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j uuid; added boolean := false; fp text; prov text; ext text; s public.job_sources;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 0));
  select * into s from public.job_sources where id = p_source and owner_id = p_owner;
  if not found then raise exception 'Source unavailable'; end if;
  select job_id into j from public.job_origins where source_id = p_source and external_id = p_external;
  prov := coalesce(p_job->>'provider', s.kind);
  ext := coalesce(p_job->>'provider_external_id', case when s.kind in ('greenhouse','lever','ashby') then s.source_key || ':' || p_external when s.kind = 'adzuna' then p_external end);
  if j is null and ext is not null then select job_id into j from public.job_origins where owner_id = p_owner and provider = prov and provider_external_id = ext limit 1; end if;
  if j is null and p_job->>'canonical_url' is not null then select id into j from public.imported_jobs where owner_id = p_owner and canonical_url = p_job->>'canonical_url'; end if;
  if j is null and p_job->>'canonical_url' is not null then select job_id into j from public.job_origins where owner_id=p_owner and direct_url=p_job->>'canonical_url' limit 1; end if;
  fp := jobpilot_private.job_fingerprint(p_job->>'company',p_job->>'title',p_job->>'location',p_job->>'description');
  if j is null and fp is not null then
    select x.id into j from public.imported_jobs x where x.owner_id = p_owner and x.fingerprint = fp
    -- Distinct IDs on the same board/provider are different requisitions even with identical copy.
    and not exists(select 1 from public.job_origins o where o.job_id = x.id and o.provider = prov and o.provider_external_id is not null and ext is not null and o.provider_external_id <> ext)
    order by x.created_at limit 1;
  end if;
  if j is null then
    insert into public.imported_jobs(owner_id,title,company,location,work_mode,description,canonical_url,requirements,uncertainty,published_at,fingerprint,employment_type,experience_years,salary_min,salary_currency,salary_period,profile_matches)
    values(p_owner,p_job->>'title',p_job->>'company',p_job->>'location',p_job->>'work_mode',p_job->>'description',p_job->>'canonical_url',
      array(select jsonb_array_elements_text(p_job->'requirements')),array(select jsonb_array_elements_text(p_job->'uncertainty')),(p_job->>'published_at')::timestamptz,fp,
      p_job->>'employment_type',(p_job->>'experience_years')::integer,(p_job->>'salary_min')::numeric,p_job->>'salary_currency',p_job->>'salary_period',coalesce(p_job->'profile_matches','[]')) returning id into j;
    insert into public.job_reviews(owner_id,job_id) values(p_owner,j);
    added := true;
  end if;
  insert into public.job_origins(owner_id,job_id,source_id,external_id,message_id,sender,source_date,source_url,provider,provider_external_id,direct_url,parsing_confidence)
    values(p_owner,j,p_source,p_external,p_origin->>'message_id',p_origin->>'sender',(p_origin->>'source_date')::timestamptz,p_origin->>'source_url',prov,ext,p_job->>'canonical_url',coalesce(p_job->>'parsing_confidence','high')) on conflict(source_id,external_id) do nothing;
  return added;
end $$;

-- One lock and eligibility check for manual, test and scheduled provider work.
create function public.claim_source_test(p_owner uuid, p_source uuid) returns public.import_runs
language plpgsql security definer set search_path = '' as $$
declare r public.import_runs;
begin
  perform 1 from public.job_sources where id = p_source and owner_id = p_owner and removed_at is null and kind <> 'manual'
    and (next_eligible_at is null or next_eligible_at <= now()) for update;
  if not found then raise exception 'Source unavailable'; end if;
  update public.import_runs set status='failed',error_code='interrupted',finished_at=now() where source_id=p_source and status='running' and started_at < now()-interval '5 minutes';
  insert into public.import_runs(owner_id,source_id) values(p_owner,p_source) returning * into r;
  update public.job_sources set last_attempted_at=now() where id=p_source;
  return r;
end $$;

create or replace function public.start_job_import(p_owner uuid, p_source uuid) returns public.import_runs
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.job_sources where id=p_source and owner_id=p_owner and enabled for update;
  if not found then raise exception 'Source unavailable'; end if;
  return public.claim_source_test(p_owner,p_source);
end $$;

create or replace function public.scheduled_discovery_sources(p_run uuid) returns setof public.job_sources
language sql security definer set search_path = '' as $$
  select s.* from public.job_sources s join public.automation_runs a on a.owner_id=s.owner_id
  join public.discovery_automation c on c.owner_id=a.owner_id
  where a.id=p_run and a.status='running' and a.lease_until>now() and c.enabled and s.enabled and s.removed_at is null
    and s.kind in ('gmail','greenhouse','lever','ashby','adzuna') and (s.next_eligible_at is null or s.next_eligible_at<=now())
    and not exists(select 1 from public.import_runs i where i.source_id=s.id and i.status='running' and i.started_at>now()-interval '5 minutes')
  order by (select max(i.started_at) from public.import_runs i where i.source_id=s.id) asc nulls first,s.id limit 3;
$$;

-- A failed attempt keeps its last completed checkpoint. Backoff is persisted, never slept in a worker.
create function public.source_backoff(p_owner uuid,p_run uuid,p_retry_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.import_runs;
begin
  select * into r from public.import_runs where id=p_run and owner_id=p_owner and status='running' and started_at>now()-interval '5 minutes';
  if not found then return; end if;
  perform 1 from public.job_sources where id=r.source_id for update;
  update public.job_sources set failure_count=least(failure_count+1,10), next_eligible_at=greatest(p_retry_at,now()+make_interval(secs=>least(86400,60*power(2,least(failure_count,10)))::integer)) where id=r.source_id;
end $$;

create function jobpilot_private.import_health() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status='running' and new.status<>'running' then
    update public.job_sources set last_error_code=new.error_code,last_added=new.imported_count,last_duplicates=new.duplicate_count,
      failure_count=case when new.status='succeeded' then 0 else failure_count end,
      next_eligible_at=case when new.status='succeeded' then greatest(next_eligible_at,now()+interval '1 minute') else next_eligible_at end where id=new.source_id;
  end if;
  return new;
end $$;
create trigger import_health after update on public.import_runs for each row execute function jobpilot_private.import_health();
revoke all on function jobpilot_private.import_health() from public,anon,authenticated;

create function public.finish_source_test(p_owner uuid,p_run uuid,p_error text) returns void language sql security definer set search_path = '' as $$
  update public.import_runs set status=case when p_error is null then 'succeeded' else 'failed' end,error_code=p_error,finished_at=now()
  where id=p_run and owner_id=p_owner and status='running' and started_at>now()-interval '5 minutes';
$$;

create function public.remove_discovery_source(p_owner uuid,p_source uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.job_sources where id=p_source and owner_id=p_owner and kind in ('greenhouse','lever','ashby','adzuna') for update;
  if not found then raise exception 'Source unavailable'; end if;
  update public.job_sources set enabled=false,removed_at=now() where id=p_source;
end $$;

create table jobpilot_private.manual_discovery (
  owner_id uuid primary key references jobpilot_private.owner_registration(user_id),
  id uuid not null, lease_until timestamptz not null, next_at timestamptz not null
);
revoke all on jobpilot_private.manual_discovery from public,anon,authenticated;
alter table jobpilot_private.manual_discovery enable row level security;
create function public.claim_manual_discovery(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid(); sources jsonb;
begin
  if not public.phase3_is_owner(p_owner) then raise exception 'Owner access required'; end if;
  insert into jobpilot_private.manual_discovery values(p_owner,token,now()+interval '3 minutes',now()+interval '1 minute')
    on conflict(owner_id) do update set id=token,lease_until=now()+interval '3 minutes',next_at=now()+interval '1 minute'
    where manual_discovery.lease_until<=now() and manual_discovery.next_at<=now();
  if not found then return null; end if;
  select coalesce(jsonb_agg(q.id),'[]') into sources from (
    select s.id from public.job_sources s where s.owner_id=p_owner and s.enabled and s.removed_at is null and s.kind<>'manual'
      and (s.next_eligible_at is null or s.next_eligible_at<=now())
      and not exists(select 1 from public.import_runs i where i.source_id=s.id and i.status='running' and i.started_at>now()-interval '5 minutes')
    order by s.last_attempted_at asc nulls first,s.id limit 3
  ) q;
  return jsonb_build_object('id',token,'sources',sources);
end $$;
create function public.finish_manual_discovery(p_owner uuid,p_id uuid) returns void language sql security definer set search_path='' as $$
  update jobpilot_private.manual_discovery set lease_until=now() where owner_id=p_owner and id=p_id;
$$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any(array['claim_source_test','source_backoff','finish_source_test','remove_discovery_source','claim_manual_discovery','finish_manual_discovery']) loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;
