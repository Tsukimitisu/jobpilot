import type { SupabaseClient } from '@supabase/supabase-js'
import { profilePayload, validateProfile, type Profile, type ProfileDraft } from './profile'

export type Resume = { id: string; owner_id: string; object_path: string; original_name: string; byte_size: number; status: 'pending' | 'ready'; created_at: string }
export type Workspace = { owner: boolean; profile: Profile | null; resumes: Resume[]; defaultId: string | null }
export class WorkspaceError extends Error {}
export const maxResumeBytes = 10 * 1024 * 1024

export function requireOnline() {
  if (!navigator.onLine) throw new WorkspaceError('You’re offline. Reconnect before making changes.')
}
export async function loadWorkspace(client: SupabaseClient): Promise<Workspace> {
  const access = await client.rpc('is_jobpilot_owner')
  if (access.error) throw new WorkspaceError('Could not verify owner access. Check your connection and the Phase 2 database setup, then retry.')
  if (access.data !== true) return { owner: false, profile: null, resumes: [], defaultId: null }
  const [profile, resumes, defaults] = await Promise.all([
    client.from('owner_profiles').select('*').maybeSingle(),
    client.from('resumes').select('*').order('created_at', { ascending: false }),
    client.from('resume_defaults').select('resume_id').maybeSingle(),
  ])
  if (profile.error || resumes.error || defaults.error) throw new WorkspaceError('Could not load your saved data. Check your connection and database setup, then retry.')
  return { owner: true, profile: profile.data, resumes: resumes.data ?? [], defaultId: defaults.data?.resume_id ?? null }
}
export async function saveProfile(client: SupabaseClient, ownerId: string, draft: ProfileDraft): Promise<Profile> {
  requireOnline()
  if (Object.keys(validateProfile(draft)).length) throw new WorkspaceError('Check the highlighted profile fields.')
  try {
    const result = await client.from('owner_profiles').upsert({ ...profilePayload(draft), owner_id: ownerId }).select('*').single()
    if (result.error) throw result.error
    return result.data
  } catch { throw new WorkspaceError('Save could not be confirmed. Your entries are still here. Check your connection and owner setup, then retry or reload saved data.') }
}
export function validateResume(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf') return 'Choose a PDF file with the application/pdf file type.'
  if (file.size === 0 || file.size > maxResumeBytes) return 'Choose a non-empty PDF no larger than 10 MiB.'
  if (file.name.length > 255) return 'Shorten the file name to 255 characters or fewer.'
  return null
}
export async function uploadResume(client: SupabaseClient, ownerId: string, file: File): Promise<void> {
  requireOnline()
  const invalid = validateResume(file)
  if (invalid) throw new WorkspaceError(invalid)
  const id = crypto.randomUUID()
  const path = `${ownerId}/${id}.pdf`
  try {
    const metadata = await client.from('resumes').insert({ id, owner_id: ownerId, object_path: path, original_name: file.name, byte_size: file.size })
    if (metadata.error) throw metadata.error
  } catch { throw new WorkspaceError('Upload was not started because metadata creation could not be confirmed. Refresh the list before retrying; an incomplete entry may need deletion.') }
  try {
    const uploaded = await client.storage.from('resumes').upload(path, file, { contentType: 'application/pdf', upsert: false, cacheControl: '0' })
    if (uploaded.error) throw uploaded.error
  } catch { throw new WorkspaceError('PDF upload could not be confirmed. The incomplete entry is retained: refresh, then try “Finish upload” or delete it before uploading again.') }
  await completeResume(client, id)
}
export async function completeResume(client: SupabaseClient, id: string): Promise<void> {
  requireOnline()
  try {
    const result = await client.rpc('complete_resume', { upload_id: id })
    if (result.error) throw result.error
  } catch { throw new WorkspaceError('Upload completion could not be confirmed. Refresh the list. If still incomplete, retry “Finish upload”; if the PDF is missing, delete the entry and upload again.') }
}
export async function setDefaultResume(client: SupabaseClient, id: string): Promise<void> {
  requireOnline()
  try {
    const result = await client.rpc('set_default_resume', { selected_id: id })
    if (result.error) throw result.error
  } catch { throw new WorkspaceError('Default selection could not be confirmed. Refresh the list to check the saved selection before retrying.') }
}
export async function deleteResume(client: SupabaseClient, resume: Resume): Promise<void> {
  requireOnline()
  try {
    const storage = await client.storage.from('resumes').remove([resume.object_path])
    if (storage.error) throw storage.error
  } catch { throw new WorkspaceError('File deletion could not be confirmed. The metadata was kept. Refresh and retry deleting this entry.') }
  try {
    const metadata = await client.from('resumes').delete().eq('id', resume.id).select('id')
    if (metadata.error?.code === '23503') throw new WorkspaceError('This resume is retained by an application. For an editable draft, select another resume or clear its selection and save before deleting. Sent application attachments are retained.')
    if (metadata.error || !metadata.data?.length) throw new Error()
  } catch (error) {
    if (error instanceof WorkspaceError) throw error
    throw new WorkspaceError('Storage returned without an error, but metadata deletion could not be confirmed. The file may already be gone. Refresh the list and retry deletion if the entry remains.')
  }
}
export async function downloadResume(client: SupabaseClient, resume: Resume): Promise<Blob> {
  requireOnline()
  try {
    const result = await client.storage.from('resumes').download(resume.object_path)
    if (result.error || !result.data) throw new Error()
    return result.data
  } catch { throw new WorkspaceError('Download failed. Check your connection. If an earlier deletion was interrupted, finish deleting the entry and upload again.') }
}
export function workspaceMessage(error: unknown) {
  return error instanceof WorkspaceError ? error.message : 'The request could not finish. Check your connection and try again. Your unsaved entries have not been cleared.'
}
