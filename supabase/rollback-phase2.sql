begin;

do $$
begin
  if current_setting('jobpilot.confirm_phase2_rollback', true) is distinct from 'yes' then
    raise exception 'Rollback not confirmed. Back up Phase 2 data, remove the resumes bucket through Storage, then SET jobpilot.confirm_phase2_rollback = ''yes'' in this SQL Editor session.';
  end if;
  if exists (select 1 from storage.buckets where id = 'resumes') then
    raise exception 'Remove resumes files and then the bucket using the Storage API or dashboard before schema rollback. Do not delete Storage rows with SQL.';
  end if;
end;
$$;

drop policy jobpilot_resumes_registered_upload on storage.objects;
drop policy jobpilot_resumes_no_overwrite on storage.objects;
drop policy jobpilot_resumes_anon_guard on storage.objects;
drop policy jobpilot_resumes_owner_guard on storage.objects;
drop policy jobpilot_resumes_select on storage.objects;
drop policy jobpilot_resumes_insert on storage.objects;
drop policy jobpilot_resumes_delete on storage.objects;
drop function public.set_default_resume(uuid);
drop function public.complete_resume(uuid);
drop table public.resume_defaults;
drop table public.resumes;
drop table public.owner_profiles;
drop function jobpilot_private.stamp_profile();
drop function jobpilot_private.valid_list(text[]);
drop function public.is_jobpilot_owner();
drop table jobpilot_private.owner_registration;
drop schema jobpilot_private;

commit;
