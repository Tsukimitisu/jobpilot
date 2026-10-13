-- ADMINISTRATOR ONLY, after explicit hosted rollout approval. Not a migration.
-- First configure the two Vault entries described in PHASE5.md.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- pg_net's managed queue is readable by database roles. Never enqueue the
-- long-lived secret: sign a short-lived, purpose-bound timestamp in Postgres.
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name = 'jobpilot_scheduler_secret' and decrypted_secret ~ '^[A-Za-z0-9_-]{43,128}$')
    or not exists(select 1 from vault.decrypted_secrets where name = 'jobpilot_project_url' and decrypted_secret ~ '^https://[a-z0-9]+\.supabase\.co$')
  then raise exception 'Configure the scheduler secret and project URL in Vault first'; end if;
end $$;
create or replace function jobpilot_private.dispatch_discovery() returns bigint
language plpgsql security definer set search_path = '' as $$
declare endpoint text; credential text; issued_at text; signature text;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'jobpilot_project_url';
  select decrypted_secret into credential from vault.decrypted_secrets where name = 'jobpilot_scheduler_secret';
  if endpoint is null or endpoint !~ '^https://[a-z0-9]+\.supabase\.co$' or credential is null or credential !~ '^[A-Za-z0-9_-]{43,128}$'
    then raise exception 'Scheduler Vault configuration missing or invalid'; end if;
  issued_at := floor(extract(epoch from clock_timestamp()))::bigint::text;
  signature := encode(extensions.hmac('jobpilot-discovery-v1:' || issued_at, credential, 'sha256'), 'hex');
  return net.http_post(url := endpoint || '/functions/v1/discovery-scheduler',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || issued_at || '.' || signature),
    body := '{}'::jsonb, timeout_milliseconds := 140000);
end $$;
revoke all on function jobpilot_private.dispatch_discovery() from public, anon, authenticated, service_role;
-- Named schedule is updated in place on a repeated administrator invocation.
select cron.schedule('jobpilot-discovery-hourly', '0 * * * *', 'select jobpilot_private.dispatch_discovery();');
commit;
