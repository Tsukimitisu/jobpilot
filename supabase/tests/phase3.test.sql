begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();
insert into auth.users(id) values ('30000000-0000-0000-0000-000000000001'), ('30000000-0000-0000-0000-000000000002');
select is((select count(*)::int from jobpilot_private.owner_registration), 0, 'requires local unbootstrapped database');
insert into jobpilot_private.owner_registration(user_id) values ('30000000-0000-0000-0000-000000000001');

select ok(relrowsecurity, relname || ' has RLS') from pg_class where oid in (
  'public.gmail_connections'::regclass, 'public.gmail_credentials'::regclass, 'public.gmail_oauth_states'::regclass,
  'public.job_sources'::regclass, 'public.import_runs'::regclass, 'public.imported_jobs'::regclass, 'public.job_origins'::regclass, 'public.job_reviews'::regclass);
select ok(not has_table_privilege('anon', 'public.' || t, 'SELECT'), 'anonymous cannot read ' || t)
from unnest(array['gmail_connections','gmail_credentials','gmail_oauth_states','job_sources','import_runs','imported_jobs','job_origins','job_reviews']) t;
select ok(not has_function_privilege('authenticated', p.oid, 'EXECUTE'), 'browser cannot execute backend RPC ' || p.proname)
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array['phase3_is_owner','set_gmail_label','begin_gmail_oauth','consume_gmail_state','finish_gmail_oauth','disconnect_gmail','start_job_import','finish_job_import','store_job_candidate']);

set local role service_role;
select public.begin_gmail_oauth('30000000-0000-0000-0000-000000000001', 'owner@example.invalid', 'fixture-hash', 'fixture-verifier');
select is((select count(*)::int from public.consume_gmail_state('wrong-hash')), 0, 'wrong state rejected');
select is((select count(*)::int from public.consume_gmail_state('fixture-hash')), 1, 'valid state consumed');
select is((select count(*)::int from public.consume_gmail_state('fixture-hash')), 0, 'state reuse rejected');
select public.begin_gmail_oauth('30000000-0000-0000-0000-000000000001', 'owner@example.invalid', 'expired-hash', 'fixture-verifier');
update public.gmail_oauth_states set expires_at = now() - interval '1 second';
select is((select count(*)::int from public.consume_gmail_state('expired-hash')), 0, 'expired state rejected');
select is(public.finish_gmail_oauth('30000000-0000-0000-0000-000000000001', (select generation from public.gmail_connections), 'other@example.invalid', 'inert'), false, 'wrong identity cannot commit');
select is(public.finish_gmail_oauth('30000000-0000-0000-0000-000000000001', gen_random_uuid(), 'owner@example.invalid', 'inert'), false, 'superseded generation cannot commit');
select is(public.finish_gmail_oauth('30000000-0000-0000-0000-000000000001', (select generation from public.gmail_connections), 'owner@example.invalid', 'inert-encrypted-fixture'), true, 'matching generation commits');
select public.disconnect_gmail('30000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.gmail_credentials), 0, 'disconnect removes credentials');
select is((select count(*)::int from public.gmail_oauth_states), 0, 'disconnect invalidates pending state');
select public.set_gmail_label('30000000-0000-0000-0000-000000000001', 'Label_fixture', 'JobPilot/Alerts');
insert into public.job_sources(id, owner_id, kind, source_key, name) values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'greenhouse', 'fixture', 'Fixture');
select public.start_job_import('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');
select throws_ok($$select public.start_job_import('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001')$$, '23505', null, 'concurrent import blocked');
select is(public.store_job_candidate('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '42', '{"title":"Fixture Engineer","description":"Inert fixture","canonical_url":"https://example.invalid/jobs/42","requirements":[],"uncertainty":["Review"]}', '{}'), true, 'first import creates job');
select is(public.store_job_candidate('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '42', '{"description":"changed"}', '{}'), false, 'source ID duplicate does not overwrite job');
select is(public.store_job_candidate('30000000-0000-0000-0000-000000000001', (select id from public.job_sources where kind = 'gmail'), 'msg:42', '{"description":"Other source","canonical_url":"https://example.invalid/jobs/42"}', '{"message_id":"msg","sender":"fixture@example.invalid","source_date":"2026-01-01T00:00:00Z"}'), false, 'canonical URL deduplicated across sources');
select is((select count(*)::int from public.imported_jobs), 1, 'one job after repeats');
select is((select count(*)::int from public.job_origins), 2, 'both provenances preserved');
select public.finish_job_import('30000000-0000-0000-0000-000000000001', (select id from public.import_runs), null, '50', 1, 1);
select ok((select last_success_at is not null from public.job_sources where kind = 'greenhouse'), 'successful import timestamp persisted');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select is((select count(*)::int from public.imported_jobs), 1, 'owner reads jobs');
select is((select count(*)::int from public.job_sources), 2, 'owner reads sources');
select is((select count(*)::int from public.import_runs), 1, 'owner reads runs');
select is((select count(*)::int from public.job_origins), 2, 'owner reads origins');
select lives_ok($$update public.job_reviews set disposition = 'saved', reviewed = true$$, 'owner saves review');
select throws_ok('select * from public.gmail_credentials', '42501', null, 'even owner cannot read encrypted token');
select throws_ok('select * from public.gmail_oauth_states', '42501', null, 'even owner cannot read OAuth state');
select throws_ok($$update public.gmail_connections set status = 'connected'$$, '42501', null, 'owner cannot forge connection status');
select throws_ok($$insert into public.imported_jobs(owner_id, description) values(auth.uid(), 'forged')$$, '42501', null, 'browser cannot bypass importer');
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
select is((select count(*)::int from public.gmail_connections), 0, 'non-owner cannot read connections');
select is((select count(*)::int from public.job_sources), 0, 'non-owner cannot read sources');
select is((select count(*)::int from public.import_runs), 0, 'non-owner cannot read runs');
select is((select count(*)::int from public.imported_jobs), 0, 'non-owner cannot read jobs');
select is((select count(*)::int from public.job_origins), 0, 'non-owner cannot read origins');
select is((select count(*)::int from public.job_reviews), 0, 'non-owner cannot read reviews');
with changed as (update public.job_reviews set disposition = 'dismissed' returning *) select is(count(*)::int, 0, 'non-owner cannot change review') from changed;
select throws_ok($$insert into public.job_reviews(owner_id, job_id) values(auth.uid(), gen_random_uuid())$$, '42501', null, 'non-owner cannot insert review');
reset role;
select is((select disposition from public.job_reviews), 'saved', 'review survives hostile writes and duplicate imports');
select * from finish();
rollback;
