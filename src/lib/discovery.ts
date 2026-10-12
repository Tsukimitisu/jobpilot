import type { SupabaseClient } from '@supabase/supabase-js'
import type { Candidate } from '../../supabase/functions/_shared/discovery'
import { requireOnline, WorkspaceError } from './workspace'
export type Job = Candidate & { id: string; owner_id: string; created_at: string }
export type Source = { id: string; kind: 'gmail' | 'greenhouse' | 'manual'; source_key: string; name: string; enabled: boolean; cursor: string | null; last_success_at: string | null }
export type ImportRun = { id: string; source_id: string; status: string; started_at: string; finished_at: string | null; imported_count: number; duplicate_count: number; error_code: string | null }
export type Origin = { id: string; job_id: string; source_id: string; source_url: string | null; message_id: string | null; sender: string | null; source_date: string | null }
export type Review = { job_id: string; disposition: 'new' | 'saved' | 'dismissed'; reviewed: boolean }
export type GmailConnection = { status: 'connected' | 'disconnected' | 'reconnect_required'; expected_email: string; connected_email: string | null; checked_at: string | null; error_code: string | null; granted_scopes?: string[]; send_consented_at?: string | null }
export type Discovery = { connection: GmailConnection | null; sources: Source[]; runs: ImportRun[]; jobs: Job[]; origins: Origin[]; reviews: Review[]; more: boolean }
export const errorMessages: Record<string, string> = {
  invalid_state: 'This Gmail connection link expired or was already used. Start Connect Gmail again.',
  wrong_account: 'The selected Gmail account does not match your configured address. Reconnect with the correct account.',
  consent_denied: 'Gmail permission was not granted. You can try Connect Gmail again.',
  reconnect_required: 'Google access expired or was revoked. Reconnect Gmail to continue.',
  gmail_disconnected: 'Gmail is disconnected. Connect it in Settings first.',
  offline_access_missing: 'Google did not return offline access. Remove the old JobPilot grant in your Google Account, then reconnect.',
  scope_mismatch: 'Google did not grant the required permissions. Reconnect in Settings and approve the requested access.',
  send_consent_required: 'Fresh Gmail sending consent is required. Enable sending in Settings, then edit and review this draft again.',
  application_changed: 'This application changed in another request or tab. Refresh applications before continuing.',
  application_locked: 'This application cannot be edited or sent in its current state. Refresh applications to check its status.',
  application_not_found: 'This application could not be found. Refresh applications.',
  invalid_application: 'Check the recipient, subject, body, resume selection, and any tracking date.',
  job_review_required: 'Save or review this job before creating a draft.',
  resume_unavailable: 'The selected PDF is missing or inaccessible. Choose a ready resume and review again.',
  resume_changed: 'The PDF no longer matches the reviewed attachment. Edit and review again.',
  confirmation_required: 'Review the final email and explicitly confirm before sending.',
  reconciliation_required: 'Check Gmail Sent manually and add a reconciliation note of at least 10 characters.',
  send_permission_denied: 'Google rejected sending permission. Reconnect Gmail with sending consent before reviewing again.',
  gmail_rejected: 'Gmail rejected this email. Check the recipient and attachment, then explicitly edit and review before another attempt.',
  delivery_unknown: 'Gmail may have accepted this email. Check Gmail Sent manually. JobPilot will not resend it.',
  token_failure: 'Google returned an unusable token. Try reconnecting Gmail.',
  backend_configuration: 'Gmail backend secrets are missing or invalid. Check the Phase 3 setup instructions.',
  provider_unavailable: 'The source could not be reached. Try again; existing jobs are preserved.',
  permission_denied: 'Google denied this request. Check that Gmail API is enabled and read-only consent is granted, then retry.',
  source_not_found: 'The configured label or board no longer exists. Check it in Settings.',
  invalid_label: 'Choose an existing custom Gmail label. Create JobPilot/Alerts in Gmail if needed.',
  invalid_source: 'Enter a Greenhouse board token using letters, digits, underscores, or hyphens.',
  invalid_email: 'Enter the Gmail address you intend to connect.',
  invalid_job: 'Add a valid http(s) URL or a description of up to 50,000 characters.',
  rate_limited: 'The provider is rate limiting requests. Wait before refreshing again.',
  interrupted: 'The import was interrupted. Retry safely; duplicate jobs will not be created.',
  database_error: 'The database operation could not finish. Refresh status; an import may already be running. Check Phase 3 migrations if this persists.',
  import_busy: 'An import is running. Wait for it to finish before changing its label.',
  unauthorized: 'Your session could not be verified. Sign in again.', owner_required: 'Only the registered owner can use job discovery.',
  response_too_large: 'The source response exceeds the safe import limit. Use a smaller source.',
}
export const discoveryError = (code: string | null) => code ? errorMessages[code] ?? 'The request failed. Refresh status and retry; existing data is preserved.' : ''
export const gmailStatus = (connection: GmailConnection | null) => connection?.status === 'connected' ? 'Connected' : connection?.status === 'reconnect_required' ? 'Reconnect required' : 'Disconnected'
export const displayDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'Never'
export async function discoveryAction<T = { ok: boolean }>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  requireOnline()
  try {
    const result = await client.functions.invoke('jobpilot-api', { body, timeout: 115000 })
    if (result.error) {
      let code = ''
      try { code = (await result.error.context.json()).error } catch {}
      throw new WorkspaceError(discoveryError(code || 'request_failed'))
    }
    if (result.data?.error) throw new WorkspaceError(discoveryError(result.data.error))
    return result.data
  } catch (error) {
    if (error instanceof WorkspaceError) throw error
    throw new WorkspaceError('The request could not be confirmed. Refresh status before retrying; an import may still be running.')
  }
}
async function rows<T>(client: SupabaseClient, table: string, limit = Infinity): Promise<T[]> {
  const result: T[] = []
  while (result.length < limit) {
    let query = client.from(table).select('*')
    if (table === 'imported_jobs') query = query.order('created_at', { ascending: false })
    const size = Math.min(500, limit - result.length)
    const page = await query.order(table === 'job_reviews' ? 'job_id' : 'id').range(result.length, result.length + size - 1)
    if (page.error) throw new WorkspaceError('Could not load job discovery. Check your connection and the Phase 3 backend setup, then refresh.')
    result.push(...(page.data ?? []) as T[])
    if ((page.data?.length ?? 0) < size) break
  }
  return result
}
export async function loadDiscovery(client: SupabaseClient, limit = 100): Promise<Discovery> {
  const [connection, sources, runs, jobs, origins, reviews] = await Promise.all([
    client.from('gmail_connections').select('status,expected_email,connected_email,checked_at,error_code,granted_scopes,send_consented_at').maybeSingle(),
    rows<Source>(client, 'job_sources'),
    client.from('import_runs').select('*').order('started_at', { ascending: false }).limit(20),
    rows<Job>(client, 'imported_jobs', limit + 1), rows<Origin>(client, 'job_origins'), rows<Review>(client, 'job_reviews'),
  ])
  if (connection.error || runs.error) throw new WorkspaceError('Could not load job discovery. Check your connection and the Phase 3 backend setup, then refresh.')
  return { connection: connection.data, sources, runs: runs.data ?? [], jobs: jobs.slice(0, limit), origins, reviews, more: jobs.length > limit }
}
export async function saveReview(client: SupabaseClient, owner: string, job: string, disposition: Review['disposition'], reviewed: boolean) {
  requireOnline()
  const result = await client.from('job_reviews').update({ disposition, reviewed }).eq('owner_id', owner).eq('job_id', job).select('job_id').single()
  if (result.error || !result.data) throw new WorkspaceError('Review change could not be confirmed. Refresh before retrying.')
}
