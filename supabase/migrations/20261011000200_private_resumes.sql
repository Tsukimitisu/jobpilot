begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 10485760, array['application/pdf']);

create table public.resumes (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  object_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 255),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  status text not null default 'pending' check (status in ('pending','ready')),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  check (object_path = owner_id::text || '/' || id::text || '.pdf')
);
create index resumes_owner_created on public.resumes(owner_id, created_at desc);

create table public.resume_defaults (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  resume_id uuid not null,
  foreign key (owner_id, resume_id) references public.resumes(owner_id, id) on delete cascade
);

alter table public.resumes enable row level security;
alter table public.resume_defaults enable row level security;
revoke all on public.resumes, public.resume_defaults from public, anon, authenticated;
grant select, delete on public.resumes to authenticated;
grant insert (id, owner_id, object_path, original_name, byte_size) on public.resumes to authenticated;
grant select on public.resume_defaults to authenticated;

create policy resumes_select on public.resumes for select to authenticated
using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));
create policy resumes_insert on public.resumes for insert to authenticated
with check ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));
create policy resumes_delete on public.resumes for delete to authenticated
using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));
create policy resume_defaults_select on public.resume_defaults for select to authenticated
using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));

create policy jobpilot_resumes_select on storage.objects for select to authenticated
using (bucket_id = 'resumes' and (select public.is_jobpilot_owner()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy jobpilot_resumes_insert on storage.objects for insert to authenticated
with check (bucket_id = 'resumes' and (select public.is_jobpilot_owner()) and exists (
  select 1 from public.resumes r where r.object_path = name and r.owner_id = (select auth.uid()) and r.status = 'pending'
));
create policy jobpilot_resumes_delete on storage.objects for delete to authenticated
using (bucket_id = 'resumes' and (select public.is_jobpilot_owner()) and (storage.foldername(name))[1] = (select auth.uid())::text);

create function public.complete_resume(upload_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare target public.resumes;
begin
  if not public.is_jobpilot_owner() then raise exception 'Owner access required' using errcode = '42501'; end if;
  select * into target from public.resumes where id = upload_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Resume not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'resumes' and name = target.object_path
    and (metadata->>'size')::bigint = target.byte_size and metadata->>'mimetype' = 'application/pdf') then
    raise exception 'Uploaded PDF not found or metadata does not match' using errcode = '23514';
  end if;
  update public.resumes set status = 'ready' where id = target.id;
end;
$$;

create function public.set_default_resume(selected_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_jobpilot_owner() then raise exception 'Owner access required' using errcode = '42501'; end if;
  perform 1 from public.resumes where id = selected_id and owner_id = auth.uid() and status = 'ready' for update;
  if not found then raise exception 'A ready resume is required' using errcode = 'P0002'; end if;
  insert into public.resume_defaults(owner_id, resume_id) values (auth.uid(), selected_id)
  on conflict (owner_id) do update set resume_id = excluded.resume_id;
end;
$$;
revoke all on function public.complete_resume(uuid), public.set_default_resume(uuid) from public, anon, authenticated;
grant execute on function public.complete_resume(uuid), public.set_default_resume(uuid) to authenticated;

commit;
