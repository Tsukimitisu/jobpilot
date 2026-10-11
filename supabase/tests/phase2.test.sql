begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

insert into auth.users(id) values ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
select is((select count(*)::int from jobpilot_private.owner_registration), 0, 'test requires a local unbootstrapped database');
select is((select public from storage.buckets where id = 'resumes'), false, 'resumes bucket is private');
select is((select file_size_limit from storage.buckets where id = 'resumes'), 10485760::bigint, 'bucket enforces 10 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'resumes'), array['application/pdf'], 'bucket only allows PDF MIME');

set local role anon;
select throws_ok('select * from public.owner_profiles', '42501', null, 'anonymous profile read denied');
select throws_ok('select * from public.resumes', '42501', null, 'anonymous metadata read denied');
select throws_ok('select public.is_jobpilot_owner()', '42501', null, 'anonymous helper denied');
select throws_ok('select public.set_default_resume(gen_random_uuid())', '42501', null, 'anonymous privileged RPC denied');
select is((select count(*)::int from storage.objects where bucket_id = 'resumes'), 0, 'anonymous storage read empty');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is(public.is_jobpilot_owner(), false, 'unconfigured ownership fails closed');
select throws_ok($$insert into public.owner_profiles(owner_id, full_name, contact_email) values (auth.uid(), 'Test', 'test@example.invalid')$$, '42501', null, 'unconfigured profile insert denied');
select throws_ok($$insert into jobpilot_private.owner_registration(user_id) values(auth.uid())$$, '42501', null, 'browser cannot appoint owner');
reset role;
insert into jobpilot_private.owner_registration(user_id) values ('10000000-0000-0000-0000-000000000001');

set local role authenticated;
select is(public.is_jobpilot_owner(), true, 'registered owner recognized');
select lives_ok($$insert into public.owner_profiles(owner_id, full_name, contact_email) values (auth.uid(), 'Test Owner', 'test@example.invalid')$$, 'owner profile insert');
select is((select full_name from public.owner_profiles), 'Test Owner', 'owner profile read');
select lives_ok($$update public.owner_profiles set location = 'Test City' where owner_id = auth.uid()$$, 'owner profile update');
select throws_ok($$update public.owner_profiles set salary_min = 10, salary_max = 1$$, '23514', null, 'invalid salary rejected');
select throws_ok($$update public.owner_profiles set work_modes = array['invented']$$, '23514', null, 'invalid preference rejected');
select throws_ok($$update jobpilot_private.owner_registration set user_id = '10000000-0000-0000-0000-000000000002'$$, '42501', null, 'owner cannot change registration');
select lives_ok($$insert into public.resumes(id, owner_id, object_path, original_name, byte_size) values
('20000000-0000-0000-0000-000000000001', auth.uid(), auth.uid()::text || '/20000000-0000-0000-0000-000000000001.pdf', 'one.pdf', 100),
('20000000-0000-0000-0000-000000000002', auth.uid(), auth.uid()::text || '/20000000-0000-0000-0000-000000000002.pdf', 'two.pdf', 100)$$, 'owner creates pending metadata');
select throws_ok($$select public.set_default_resume('20000000-0000-0000-0000-000000000001')$$, 'P0002', null, 'pending cannot be default');
select throws_ok($$select public.complete_resume('20000000-0000-0000-0000-000000000001')$$, '23514', null, 'completion requires object');
select throws_ok($$update public.resumes set status = 'ready'$$, '42501', null, 'client cannot bypass completion');
select throws_ok($$insert into storage.objects(bucket_id, name) values('resumes', auth.uid()::text || '/unregistered.pdf')$$, '42501', null, 'unregistered object rejected');
select lives_ok($$insert into storage.objects(bucket_id, name, metadata) select 'resumes', object_path, '{"size":100,"mimetype":"application/pdf"}'::jsonb from public.resumes$$, 'owner storage insertion under UUID');
select is((select count(*)::int from storage.objects where bucket_id = 'resumes'), 2, 'owner storage read');
select lives_ok($$select public.complete_resume(id) from public.resumes$$, 'owner completes matching uploads');
select lives_ok($$select public.set_default_resume('20000000-0000-0000-0000-000000000001')$$, 'owner sets default');
select lives_ok($$select public.set_default_resume('20000000-0000-0000-0000-000000000002')$$, 'owner switches default');
select is((select count(*)::int from public.resume_defaults), 1, 'at most one default');
select is((select resume_id::text from public.resume_defaults), '20000000-0000-0000-0000-000000000002', 'new default selected');
select throws_ok($$insert into public.resume_defaults values(auth.uid(), '20000000-0000-0000-0000-000000000001')$$, '42501', null, 'direct default writes denied');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is(public.is_jobpilot_owner(), false, 'other authenticated user is not owner');
select is((select count(*)::int from public.owner_profiles), 0, 'non-owner cannot read profile');
select is((select count(*)::int from public.resumes), 0, 'non-owner cannot read metadata');
select is((select count(*)::int from public.resume_defaults), 0, 'non-owner cannot read default');
select is((select count(*)::int from storage.objects where bucket_id = 'resumes'), 0, 'non-owner cannot read objects');
select throws_ok($$insert into public.owner_profiles(owner_id, full_name, contact_email) values (auth.uid(), 'Other', 'other@example.invalid')$$, '42501', null, 'non-owner cannot create own profile');
with changed as (update public.owner_profiles set full_name = 'Stolen' returning *) select is(count(*)::int, 0, 'non-owner cannot update owner profile') from changed;
with removed as (delete from public.resumes returning *) select is(count(*)::int, 0, 'non-owner cannot delete metadata') from removed;
select throws_ok($$delete from storage.objects where bucket_id = 'resumes'$$, null, null, 'Storage rejects direct SQL deletion; API deletion is checked separately');
select throws_ok($$insert into storage.objects(bucket_id, name) values('resumes', '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001.pdf')$$, '42501', null, 'non-owner cannot upload to owner folder');
select throws_ok($$insert into storage.objects(bucket_id, name) values('resumes', auth.uid()::text || '/other.pdf')$$, '42501', null, 'non-owner cannot upload to own folder');
select throws_ok($$select public.complete_resume('20000000-0000-0000-0000-000000000001')$$, '42501', 'Owner access required', 'non-owner cannot finalize');
select throws_ok($$select public.set_default_resume('20000000-0000-0000-0000-000000000001')$$, '42501', 'Owner access required', 'non-owner cannot change default');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select full_name from public.owner_profiles), 'Test Owner', 'owner data unchanged');
select is((select count(*)::int from storage.objects where bucket_id = 'resumes'), 2, 'objects remain intact after non-owner attempts');
select lives_ok($$delete from public.resumes where id = '20000000-0000-0000-0000-000000000002'$$, 'owner metadata deletion');
select is((select count(*)::int from public.resume_defaults), 0, 'deleting default clears selection');
reset role;
select * from finish();
rollback;
