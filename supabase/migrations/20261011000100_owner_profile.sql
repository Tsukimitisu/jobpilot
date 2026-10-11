begin;

create schema jobpilot_private;
revoke all on schema jobpilot_private from public, anon, authenticated;

create table jobpilot_private.owner_registration (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  registered_at timestamptz not null default now()
);
alter table jobpilot_private.owner_registration enable row level security;
revoke all on jobpilot_private.owner_registration from public, anon, authenticated;

create function public.is_jobpilot_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from jobpilot_private.owner_registration where user_id = (select auth.uid()));
$$;
revoke all on function public.is_jobpilot_owner() from public, anon, authenticated;
grant execute on function public.is_jobpilot_owner() to authenticated;

create function jobpilot_private.valid_list(items text[]) returns boolean
language sql immutable set search_path = ''
as $$
  select items is null or (cardinality(items) between 1 and 100
    and not exists (select 1 from unnest(items) item where item is null or length(btrim(item)) not between 1 and 200));
$$;
revoke all on function jobpilot_private.valid_list(text[]) from public, anon, authenticated;

create table public.owner_profiles (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) between 1 and 150),
  contact_email text not null check (length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text check (length(phone) <= 50),
  location text check (length(location) <= 200),
  github_url text check (length(github_url) <= 2048 and github_url ~ '^https?://[^[:space:]]+$'),
  portfolio_url text check (length(portfolio_url) <= 2048 and portfolio_url ~ '^https?://[^[:space:]]+$'),
  summary text check (length(summary) <= 10000),
  skills text[] check (jobpilot_private.valid_list(skills)),
  experience text check (length(experience) <= 20000),
  projects text check (length(projects) <= 20000),
  target_titles text[] check (jobpilot_private.valid_list(target_titles)),
  preferred_locations text[] check (jobpilot_private.valid_list(preferred_locations)),
  work_modes text[] check (cardinality(work_modes) between 1 and 3 and work_modes <@ array['remote','hybrid','on-site']::text[] and array_position(work_modes, null) is null),
  employment_types text[] check (cardinality(employment_types) between 1 and 6 and employment_types <@ array['full-time','part-time','contract','temporary','internship','freelance']::text[] and array_position(employment_types, null) is null),
  salary_min numeric(12,2) check (salary_min >= 0),
  salary_max numeric(12,2) check (salary_max >= 0),
  salary_currency text check (salary_currency ~ '^[A-Z]{3}$'),
  salary_period text check (salary_period in ('hour','month','year')),
  availability text check (length(availability) <= 2000),
  updated_at timestamptz not null default now(),
  check (salary_min is null or salary_max is null or salary_min <= salary_max),
  check ((salary_min is null and salary_max is null) or (salary_currency is not null and salary_period is not null))
);

create function jobpilot_private.stamp_profile() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;
revoke all on function jobpilot_private.stamp_profile() from public, anon, authenticated;
create trigger stamp_profile before update on public.owner_profiles
for each row execute function jobpilot_private.stamp_profile();

alter table public.owner_profiles enable row level security;
revoke all on public.owner_profiles from public, anon, authenticated;
grant select, insert, update on public.owner_profiles to authenticated;
grant usage on schema jobpilot_private to authenticated;
grant execute on function jobpilot_private.valid_list(text[]) to authenticated;
create policy owner_profile_select on public.owner_profiles for select to authenticated
using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));
create policy owner_profile_insert on public.owner_profiles for insert to authenticated
with check ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));
create policy owner_profile_update on public.owner_profiles for update to authenticated
using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()))
with check ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));

commit;
