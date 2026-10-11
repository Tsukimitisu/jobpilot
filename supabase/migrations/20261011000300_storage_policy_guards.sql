begin;

create policy jobpilot_resumes_owner_guard on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'resumes' or ((select public.is_jobpilot_owner()) and (storage.foldername(name))[1] = (select auth.uid())::text))
with check (bucket_id <> 'resumes' or ((select public.is_jobpilot_owner()) and (storage.foldername(name))[1] = (select auth.uid())::text));

create policy jobpilot_resumes_anon_guard on storage.objects as restrictive for all to anon
using (bucket_id <> 'resumes') with check (bucket_id <> 'resumes');

create policy jobpilot_resumes_no_overwrite on storage.objects as restrictive for update to anon, authenticated
using (bucket_id <> 'resumes') with check (bucket_id <> 'resumes');

create policy jobpilot_resumes_registered_upload on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'resumes' or exists (
  select 1 from public.resumes r where r.object_path = name and r.owner_id = (select auth.uid()) and r.status = 'pending'
));

commit;
