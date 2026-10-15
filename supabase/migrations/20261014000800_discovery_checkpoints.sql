begin;
create function public.checkpoint_import(p_owner uuid,p_run uuid,p_cursor text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.import_runs;
begin
  select * into r from public.import_runs where id=p_run and owner_id=p_owner;
  if r.automation_run_id is not null then
    perform 1 from public.discovery_automation c join public.automation_runs a on a.owner_id=c.owner_id
      where c.owner_id=p_owner and c.enabled and a.id=r.automation_run_id and a.status='running' and a.lease_until>now() for update of c;
    if not found then raise exception 'Schedule paused or expired'; end if;
  end if;
  perform 1 from public.job_sources where id=r.source_id and owner_id=p_owner and enabled and removed_at is null for update;
  if not found then raise exception 'Source unavailable'; end if;
  perform 1 from public.import_runs where id=p_run and status='running' and started_at>now()-interval '5 minutes' for update;
  if not found then raise exception 'Import expired'; end if;
  update public.job_sources set cursor=p_cursor where id=r.source_id;
end $$;
revoke all on function public.checkpoint_import(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.checkpoint_import(uuid,uuid,text) to service_role;

create table jobpilot_private.provider_cooldowns (
  owner_id uuid not null references jobpilot_private.owner_registration(user_id),
  provider text not null, retry_at timestamptz not null,primary key(owner_id,provider)
);
alter table jobpilot_private.provider_cooldowns enable row level security;
revoke all on jobpilot_private.provider_cooldowns from public,anon,authenticated;
-- Public owner-readable health metadata, never provider credentials or attempt errors.
alter table public.job_sources add column provider_retry_at timestamptz;
create function jobpilot_private.inherit_provider_cooldown() returns trigger language plpgsql security definer set search_path='' as $$
begin
  select retry_at into new.provider_retry_at from jobpilot_private.provider_cooldowns
    where owner_id=new.owner_id and provider=new.kind and retry_at>now();
  new.next_eligible_at:=greatest(new.next_eligible_at,new.provider_retry_at);
  return new;
end $$;
create trigger inherit_provider_cooldown before insert on public.job_sources for each row execute function jobpilot_private.inherit_provider_cooldown();
revoke all on function jobpilot_private.inherit_provider_cooldown() from public,anon,authenticated;
create function public.provider_backoff(p_owner uuid,p_run uuid,p_retry_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare s public.job_sources; until_at timestamptz:=greatest(p_retry_at,now()+interval '1 minute');
begin
  select j.* into s from public.job_sources j join public.import_runs r on r.source_id=j.id
    where r.id=p_run and r.owner_id=p_owner and r.status='running' and r.started_at>now()-interval '5 minutes';
  if not found then return; end if;
  insert into jobpilot_private.provider_cooldowns values(p_owner,s.kind,until_at)
    on conflict(owner_id,provider) do update set retry_at=greatest(provider_cooldowns.retry_at,excluded.retry_at);
  update public.job_sources set next_eligible_at=greatest(next_eligible_at,until_at),provider_retry_at=greatest(provider_retry_at,until_at) where owner_id=p_owner and kind=s.kind;
end $$;
create function public.source_provider_ready(p_owner uuid,p_source uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.job_sources s where s.id=p_source and s.owner_id=p_owner and s.removed_at is null
    and not exists(select 1 from jobpilot_private.provider_cooldowns c where c.owner_id=p_owner and c.provider=s.kind and c.retry_at>now()));
$$;
create function jobpilot_private.enforce_provider_cooldown() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.source_provider_ready(new.owner_id,new.source_id) then raise exception 'Provider cooling down'; end if;
  return new;
end $$;
create trigger enforce_provider_cooldown before insert on public.import_runs for each row execute function jobpilot_private.enforce_provider_cooldown();
revoke all on function jobpilot_private.enforce_provider_cooldown() from public,anon,authenticated;

create function jobpilot_private.cancel_paused_imports() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (old.enabled and not new.enabled) or (old.removed_at is null and new.removed_at is not null) then
    update public.import_runs set status='failed',error_code='source_paused',finished_at=now() where source_id=new.id and status='running';
  end if;
  return new;
end $$;
create trigger cancel_paused_imports after update of enabled,removed_at on public.job_sources for each row execute function jobpilot_private.cancel_paused_imports();
revoke all on function jobpilot_private.cancel_paused_imports() from public,anon,authenticated;
revoke all on function public.provider_backoff(uuid,uuid,timestamptz),public.source_provider_ready(uuid,uuid) from public,anon,authenticated;
grant execute on function public.provider_backoff(uuid,uuid,timestamptz),public.source_provider_ready(uuid,uuid) to service_role;
commit;
