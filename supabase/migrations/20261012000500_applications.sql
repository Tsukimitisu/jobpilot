begin;

-- Existing connections remain usable for imports; none receives send consent.
alter table public.gmail_connections add column granted_scopes text[] not null default '{}',
  add column send_consented_at timestamptz, add column pending_generation uuid;
alter table public.gmail_oauth_states add column requested_send boolean not null default false;

create function public.begin_gmail_oauth_v4(p_owner uuid, p_email text, p_hash text, p_verifier text, p_send boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g uuid := gen_random_uuid();
begin
  if not public.phase3_is_owner(p_owner) then raise exception 'Owner access required' using errcode = '42501'; end if;
  insert into public.gmail_connections(owner_id, expected_email) values(p_owner, p_email) on conflict do nothing;
  update public.gmail_connections set pending_generation = g where owner_id = p_owner;
  insert into public.gmail_oauth_states(owner_id,state_hash,verifier,generation,expected_email,expires_at,requested_send)
    values(p_owner,p_hash,p_verifier,g,p_email,now() + interval '10 minutes',p_send)
  on conflict(owner_id) do update set state_hash = excluded.state_hash, verifier = excluded.verifier,
    generation = g, expected_email = p_email, expires_at = excluded.expires_at, requested_send = p_send;
  return g;
end $$;
create function public.consume_gmail_state_v4(p_hash text) returns setof public.gmail_oauth_states
language sql security definer set search_path = '' as $$
  delete from public.gmail_oauth_states s using public.gmail_connections c, jobpilot_private.owner_registration o
  where s.state_hash = p_hash and s.expires_at > now() and s.owner_id = c.owner_id
    and s.generation = c.pending_generation and o.user_id = s.owner_id returning s.*;
$$;
create function public.finish_gmail_oauth_v4(p_owner uuid, p_generation uuid, p_email text, p_encrypted text, p_scopes text[], p_send boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c public.gmail_connections;
begin
  select * into c from public.gmail_connections where owner_id = p_owner and pending_generation = p_generation for update;
  if not found then return false; end if;
  if not ('https://www.googleapis.com/auth/gmail.readonly' = any(p_scopes)) or
    (p_send and not ('https://www.googleapis.com/auth/gmail.send' = any(p_scopes))) then raise exception 'scope_mismatch'; end if;
  if c.expected_email <> p_email then
    update public.job_sources set enabled = false, cursor = null, last_success_at = null where owner_id = p_owner and kind = 'gmail';
  end if;
  insert into public.gmail_credentials(owner_id, encrypted_refresh_token, generation) values(p_owner,p_encrypted,p_generation)
    on conflict(owner_id) do update set encrypted_refresh_token = p_encrypted, generation = p_generation;
  update public.gmail_connections set expected_email = p_email, connected_email = p_email, generation = p_generation,
    pending_generation = null, status = 'connected', checked_at = now(), error_code = null, granted_scopes = p_scopes,
    send_consented_at = case when p_send then now() else null end where owner_id = p_owner;
  return true;
end $$;
create function public.disconnect_gmail_v4(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.disconnect_gmail(p_owner);
  update public.gmail_connections set pending_generation = null, granted_scopes = '{}', send_consented_at = null where owner_id = p_owner;
end $$;

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references jobpilot_private.owner_registration(user_id) on delete restrict,
  job_id uuid not null,
  resume_id uuid,
  recipient text not null default '' check (length(recipient) <= 254),
  recipient_verified boolean not null default false,
  subject text not null default '' check (length(subject) <= 200 and subject !~ '[\r\n]'),
  body text not null default '' check (length(body) <= 20000),
  status text not null default 'draft' check (status in ('draft','ready','sending','sent','failed','delivery_unknown','external')),
  revision integer not null default 1,
  sender_email text,
  gmail_generation uuid,
  resume_name text,
  resume_bytes bigint,
  resume_sha256 text,
  attempt_id uuid,
  gmail_message_id text,
  error_code text,
  reconciliation_note text check (length(reconciliation_note) <= 2000),
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  sending_at timestamptz,
  sent_at timestamptz,
  external_sent_at timestamptz,
  foreign key (job_id,owner_id) references public.imported_jobs(id,owner_id),
  foreign key (owner_id,resume_id) references public.resumes(owner_id,id),
  unique(owner_id,job_id),
  check (status not in ('ready','sending','sent','delivery_unknown') or
    (recipient_verified and recipient <> '' and subject <> '' and body <> '' and resume_id is not null and resume_sha256 is not null)),
  check (status <> 'sent' or (sent_at is not null and (gmail_message_id is not null or reconciled_at is not null))),
  check (status <> 'external' or external_sent_at is not null)
);
create index applications_owner_created on public.applications(owner_id,created_at desc);
alter table public.applications enable row level security;
revoke all on public.applications from public,anon,authenticated;
grant select on public.applications to authenticated;
grant all on public.applications to service_role;
grant select on public.resumes to service_role;
create policy owner_read on public.applications for select to authenticated
using ((select public.is_jobpilot_owner()) and owner_id = (select auth.uid()));

-- Storage API deletion must not remove a PDF that is pinned to an application.
create policy jobpilot_application_resume_guard on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'resumes' or not exists (
  select 1 from public.applications a join public.resumes r on r.id = a.resume_id and r.owner_id = a.owner_id
  where r.object_path = name
));

create function public.application_command(p_owner uuid, p_action text, p_id uuid, p_revision integer, p_data jsonb default '{}') returns public.applications
language plpgsql security definer set search_path = '' as $$
declare a public.applications; c public.gmail_connections; r public.resumes;
begin
  if not public.phase3_is_owner(p_owner) then raise exception 'owner_required'; end if;
  if p_action = 'create' then
    if not exists(select 1 from public.job_reviews where owner_id = p_owner and job_id = (p_data->>'job_id')::uuid
      and (disposition = 'saved' or reviewed) and disposition <> 'dismissed') then raise exception 'job_review_required'; end if;
    insert into public.applications(owner_id,job_id,subject,body)
      values(p_owner,(p_data->>'job_id')::uuid,p_data->>'subject',p_data->>'body')
      on conflict(owner_id,job_id) do nothing;
    select * into a from public.applications where owner_id = p_owner and job_id = (p_data->>'job_id')::uuid;
    return a;
  end if;
  select * into a from public.applications where owner_id = p_owner and id = p_id for update;
  if not found then raise exception 'application_not_found'; end if;
  if a.revision <> p_revision then raise exception 'application_changed'; end if;
  if p_action = 'save' then
    if a.status not in ('draft','ready','failed') or a.attempt_id is not null then raise exception 'application_locked'; end if;
    update public.applications set recipient = p_data->>'recipient', recipient_verified = (p_data->>'recipient_verified')::boolean,
      subject = p_data->>'subject', body = p_data->>'body', resume_id = nullif(p_data->>'resume_id','')::uuid,
      status = 'draft', ready_at = null, resume_sha256 = null, sender_email = null, error_code = null where id = a.id;
  elsif p_action = 'ready' then
    if a.status <> 'draft' then raise exception 'application_locked'; end if;
    if not a.recipient_verified or a.recipient !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'
      or a.subject = '' or a.body = '' then raise exception 'invalid_application'; end if;
    select * into r from public.resumes where id = a.resume_id and owner_id = p_owner and status = 'ready' for share;
    if not found then raise exception 'resume_unavailable'; end if;
    select * into c from public.gmail_connections where owner_id = p_owner;
    update public.applications set status = 'ready', ready_at = now(), resume_name = r.original_name, resume_bytes = r.byte_size,
      resume_sha256 = p_data->>'resume_sha256', sender_email = c.connected_email, gmail_generation = c.generation where id = a.id;
  elsif p_action = 'reserve' then
    if a.status <> 'ready' or a.attempt_id is not null then raise exception 'application_locked'; end if;
    select * into c from public.gmail_connections where owner_id = p_owner for share;
    if c.status is distinct from 'connected' or c.send_consented_at is null or c.generation is distinct from a.gmail_generation
      or not ('https://www.googleapis.com/auth/gmail.send' = any(c.granted_scopes)) then raise exception 'send_consent_required'; end if;
    update public.applications set status = 'sending', attempt_id = gen_random_uuid(), sending_at = now(), error_code = null where id = a.id;
  elsif p_action = 'finish' then
    if a.status <> 'sending' or a.attempt_id is distinct from (p_data->>'attempt_id')::uuid then raise exception 'application_locked'; end if;
    if p_data->>'status' not in ('sent','failed','delivery_unknown') then raise exception 'invalid_action'; end if;
    update public.applications set status = p_data->>'status', gmail_message_id = p_data->>'gmail_message_id',
      sent_at = case when p_data->>'status' = 'sent' then now() else null end, error_code = p_data->>'error_code',
      attempt_id = case when p_data->>'status' = 'failed' then null else attempt_id end where id = a.id;
  elsif p_action = 'stale' then
    if a.status <> 'sending' or a.sending_at > now() - interval '3 minutes' then return a; end if;
    update public.applications set status = 'delivery_unknown', error_code = 'delivery_unknown' where id = a.id;
  elsif p_action = 'reconcile' then
    if a.status <> 'delivery_unknown' or length(trim(coalesce(p_data->>'note',''))) < 10 then raise exception 'reconciliation_required'; end if;
    -- Reconciliation never unlocks this initial send, even when the owner finds no message.
    update public.applications set status = case when p_data->>'outcome' = 'sent' then 'sent' else 'delivery_unknown' end,
      sent_at = case when p_data->>'outcome' = 'sent' then sending_at else null end,
      reconciliation_note = p_data->>'note', reconciled_at = now(),
      error_code = case when p_data->>'outcome' = 'sent' then null else error_code end where id = a.id;
  elsif p_action = 'external' then
    if a.status not in ('draft','ready','failed') or a.attempt_id is not null then raise exception 'application_locked'; end if;
    if (p_data->>'sent_at')::timestamptz > now() or length(trim(coalesce(p_data->>'note',''))) < 1 then raise exception 'invalid_application'; end if;
    update public.applications set status = 'external', external_sent_at = (p_data->>'sent_at')::timestamptz,
      reconciliation_note = p_data->>'note' where id = a.id;
  else raise exception 'invalid_action'; end if;
  update public.applications set revision = revision + 1, updated_at = now() where id = a.id returning * into a;
  return a;
end $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname = any(array['begin_gmail_oauth_v4','consume_gmail_state_v4','finish_gmail_oauth_v4','disconnect_gmail_v4','application_command']) loop
    execute format('revoke all on function %s from public, anon, authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;
