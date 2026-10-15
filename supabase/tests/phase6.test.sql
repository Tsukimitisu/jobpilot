begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id) values('60000000-0000-0000-0000-000000000001'),('60000000-0000-0000-0000-000000000002');
select is((select count(*)::int from jobpilot_private.owner_registration),0,'requires unbootstrapped local database');
insert into jobpilot_private.owner_registration(user_id) values('60000000-0000-0000-0000-000000000001');
select ok(relrowsecurity,'profiles have RLS') from pg_class where oid='public.search_profiles'::regclass;
select ok(not has_table_privilege('anon','public.search_profiles','SELECT'),'anonymous profiles denied');
select ok(not has_table_privilege('authenticated','public.search_profiles','INSERT'),'browser writes denied');
select ok(not has_table_privilege('authenticated','jobpilot_private.provider_cooldowns','SELECT'),'provider cooldown private');
select ok(not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'),'worker RPC private: '||p.proname)
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any(array['checkpoint_import','claim_source_test','source_backoff','provider_backoff','source_provider_ready','finish_source_test','remove_discovery_source','claim_manual_discovery','finish_manual_discovery']);
set local role service_role;
insert into public.search_profiles(owner_id,name,desired_titles) values('60000000-0000-0000-0000-000000000001','Entry roles',array['Developer']);
select is((select enabled from public.search_profiles),false,'profile starts disabled');
select throws_ok($$insert into public.search_profiles(owner_id,name,desired_titles) values('60000000-0000-0000-0000-000000000001','Bad','{}')$$,'23514',null,'desired title required');
select throws_ok($$update public.search_profiles set results_limit=51$$,'23514',null,'bounded results');
select throws_ok($$update public.search_profiles set max_experience=-1$$,'23514',null,'negative experience rejected');
select throws_ok($$update public.search_profiles set minimum_salary=-1$$,'23514',null,'negative salary rejected');
select throws_ok($$update public.search_profiles set work_modes=array['anything']$$,'23514',null,'work arrangement constrained');
select throws_ok($$update public.search_profiles set employment_types=array['anything']$$,'23514',null,'employment constrained');
insert into public.job_sources(id,owner_id,kind,source_key,name,enabled) values
('61000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','lever','fixture','Lever fixture',true),
('61000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001','ashby','fixture','Ashby fixture',true),
('61000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000001','adzuna','sg','Adzuna Singapore',true),
('61000000-0000-0000-0000-000000000004','60000000-0000-0000-0000-000000000001','adzuna','gb','Adzuna UK',true);
select is((select count(*)::int from public.job_sources where enabled),0,'new connector rows cannot start enabled');
update public.job_sources set enabled=true;
select public.start_job_import('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001');
select throws_ok($$select public.claim_source_test('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001')$$,'23505',null,'test overlaps share the import lock');
select public.checkpoint_import('60000000-0000-0000-0000-000000000001',(select id from public.import_runs),'2');
select public.finish_job_import('60000000-0000-0000-0000-000000000001',(select id from public.import_runs),'interrupted',null,0,0);
select is((select cursor from public.job_sources where kind='lever'),'2','partial checkpoint survives failure');
select throws_ok($$select public.checkpoint_import('60000000-0000-0000-0000-000000000001',(select id from public.import_runs),'stale')$$,'P0001','Import expired','old worker cannot overwrite checkpoint');

-- Deduplication fixtures: exact identity, canonical URL, full stable fingerprint,
-- and distinct requisitions which happen to share company/title/location/copy.
select is(public.store_job_candidate('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','a',
'{"title":"Developer","company":"Fixture","location":"Cebu","description":"Build accessible tools for the fixture company in Cebu.","canonical_url":"https://example.invalid/a","requirements":[],"uncertainty":[]}','{}'),true,'first job added');
select is(public.store_job_candidate('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','a','{}','{}'),false,'external identity deduplicates');
select is(public.store_job_candidate('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','different',
'{"title":"Different alert title","description":"Snippet","canonical_url":"https://example.invalid/a","requirements":[],"uncertainty":[]}','{}'),false,'canonical URL deduplicates across providers');
select is(public.store_job_candidate('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000003','123',
'{"title":"Developer","company":"Fixture","location":"Cebu","description":"Build accessible tools for the fixture company in Cebu.","canonical_url":"https://example.invalid/adzuna","requirements":[],"uncertainty":[]}','{}'),false,'stable full fingerprint deduplicates');
select is((select count(*)::int from public.job_origins),3,'all discoveries retain attribution');
reset role;
select is(jobpilot_private.job_fingerprint('Fixture','Developer','Cebu',E'Build accessible tools\nfor the fixture company in Cebu.'),jobpilot_private.job_fingerprint('fixture','developer','cebu','Build accessible tools for the fixture company in Cebu.'),'fingerprint normalizes case and whitespace before serialization');
set local role service_role;
select is(public.store_job_candidate('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','b',
'{"title":"Developer","company":"Fixture","location":"Cebu","description":"Build accessible tools for the fixture company in Cebu.","canonical_url":"https://example.invalid/b","requirements":[],"uncertainty":[]}','{}'),true,'different requisition ID on same board stays separate');
select is(public.store_job_candidate('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','c',
'{"title":"Developer","company":"Fixture","location":"Cebu","description":"Build a different product with different responsibilities.","canonical_url":"https://example.invalid/c","requirements":[],"uncertainty":[]}','{}'),true,'different description remains separate');
select public.remove_discovery_source('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.job_origins),5,'remove keeps origins');
select ok((select not enabled and removed_at is not null from public.job_sources where kind='ashby'),'removed source disabled');

select public.start_job_import('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000003');
select public.provider_backoff('60000000-0000-0000-0000-000000000001',(select id from public.import_runs where status='running'),now()+interval '2 hours');
select ok((select bool_and(next_eligible_at>=now()+interval '2 hours') from public.job_sources where kind='adzuna'),'Retry-After shared across credential markets');
select ok((select bool_and(provider_retry_at>=now()+interval '2 hours' and last_error_code is null) from public.job_sources where kind='adzuna'),'shared provider health preserves truthful last attempt errors');
insert into public.job_sources(id,owner_id,kind,source_key,name) values('61000000-0000-0000-0000-000000000005','60000000-0000-0000-0000-000000000001','adzuna','au','Adzuna Australia');
select ok((select provider_retry_at>=now()+interval '2 hours' and next_eligible_at=provider_retry_at and last_error_code is null and not enabled from public.job_sources where source_key='au'),'new source inherits visible provider cooldown while disabled');
select public.finish_source_test('60000000-0000-0000-0000-000000000001',(select id from public.import_runs where status='running'),null);
select ok((select next_eligible_at>=now()+interval '2 hours' from public.job_sources where source_key='sg'),'concurrent successful completion cannot shorten shared Retry-After');
select throws_ok($$select public.start_job_import('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000004')$$,'P0001','Source unavailable','second market cannot bypass rate limit');
select is(public.source_provider_ready('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000004'),false,'provider guard stops preselected work');
select is(public.source_provider_ready('60000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001'),true,'other provider continues normally');
select ok(public.claim_manual_discovery('60000000-0000-0000-0000-000000000001') is not null,'owner can request discovery while automation off');
select is(public.claim_manual_discovery('60000000-0000-0000-0000-000000000001'),null::jsonb,'repeated clicks blocked in database');
select throws_ok($$select public.claim_manual_discovery('60000000-0000-0000-0000-000000000002')$$,'P0001','Owner access required','manual claim rejects non-owner');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.search_profiles),1,'owner reads profiles');
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.search_profiles),0,'non-owner reads no profiles');
select is((select count(*)::int from public.job_sources),0,'non-owner reads no new connectors');
select is((select count(*)::int from public.job_origins),0,'non-owner reads no provenance');
reset role;
select * from finish();
rollback;
