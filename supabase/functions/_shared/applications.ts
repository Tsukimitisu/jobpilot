import type { SupabaseClient } from '@supabase/supabase-js'
import { ServiceError } from './google.ts'
import { validEmailText, validRecipient, type Application } from './application-data.ts'

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const codes = ['application_not_found','application_changed','application_locked','send_consent_required','resume_unavailable','invalid_application','job_review_required','reconciliation_required']
async function command(db: SupabaseClient, owner: string, action: string, id: string | null, revision: number | null, data = {}) {
  const result = await db.rpc('application_command', { p_owner: owner, p_action: action, p_id: id, p_revision: revision, p_data: data })
  if (result.error) throw new ServiceError(codes.includes(result.error.message) ? result.error.message : 'database_error')
  return result.data as Application
}
async function getApplication(db: SupabaseClient, owner: string, id: string) {
  const result = await db.from('applications').select('*').eq('owner_id',owner).eq('id',id).single()
  if (result.error || !result.data) throw new ServiceError('application_not_found')
  return result.data as Application
}
async function pdf(db: SupabaseClient, owner: string, id: string | null) {
  if (!id) throw new ServiceError('resume_unavailable')
  const result = await db.from('resumes').select('*').eq('owner_id',owner).eq('id',id).eq('status','ready').single()
  const r = result.data
  if (result.error || !r || r.object_path !== `${owner}/${id}.pdf` || r.mime_type !== 'application/pdf') throw new ServiceError('resume_unavailable')
  const download = await db.storage.from('resumes').download(r.object_path)
  if (download.error || !download.data || download.data.size !== r.byte_size || r.byte_size > 10485760) throw new ServiceError('resume_unavailable')
  const bytes = new Uint8Array(await download.data.arrayBuffer())
  if (new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new ServiceError('resume_unavailable')
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b => b.toString(16).padStart(2,'0')).join('')
  return { bytes, digest }
}
function base64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset,offset+8192))
  return btoa(binary)
}
const utf8 = (text: string) => new TextEncoder().encode(text)
const wrap = (text: string) => text.match(/.{1,76}/g)?.join('\r\n') ?? ''
function encodedHeader(text: string) {
  // Fold encoded words without splitting a UTF-8 character or exceeding RFC 2047 limits.
  const words: string[] = []; let part = ''
  for (const char of text) {
    if (utf8(part + char).length > 42) { words.push(`=?UTF-8?B?${base64(utf8(part))}?=`); part = '' }
    part += char
  }
  if (part) words.push(`=?UTF-8?B?${base64(utf8(part))}?=`)
  return words.join('\r\n ')
}
export function buildMime(a: Application, bytes: Uint8Array) {
  if (!validRecipient(a.recipient) || !validRecipient(a.sender_email) || !validEmailText(a.subject,a.body) || !a.attempt_id) throw new ServiceError('invalid_application')
  const boundary = `jobpilot_${a.attempt_id}`
  const filename = `resume-${a.resume_id}.pdf`
  const mime = [`From: ${a.sender_email}`, `To: ${a.recipient}`, `Subject: ${encodedHeader(a.subject)}`,
    `Date: ${new Date(a.sending_at ?? Date.now()).toUTCString()}`,
    `Message-ID: <${a.attempt_id}@jobpilot.invalid>`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(base64(utf8(a.body))),
    `--${boundary}`, 'Content-Type: application/pdf', 'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`, '', wrap(base64(bytes)), `--${boundary}--`, ''].join('\r\n')
  return base64(utf8(mime)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
}
export async function sendApplication(db: SupabaseClient, owner: string, id: string, revision: number, access: () => Promise<string>, transport: typeof fetch) {
  // The row lock + revision check is the sole authority to start a send.
  const a = await command(db,owner,'reserve',id,revision)
  let dispatched = false
  let outcome: { status: string; error_code?: string; gmail_message_id?: string }
  try {
    const token = await access()
    const attachment = await pdf(db,owner,a.resume_id)
    if (attachment.digest !== a.resume_sha256) throw new ServiceError('resume_changed')
    const connection = await db.from('gmail_connections').select('generation,status').eq('owner_id',owner).single()
    if (connection.error || connection.data?.generation !== a.gmail_generation || connection.data?.status !== 'connected') throw new ServiceError('send_consent_required')
    const raw = buildMime(a,attachment.bytes)
    dispatched = true
    const response = await transport('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) {
      if ([400,401,403,404,413,429].includes(response.status)) {
        dispatched = false // Explicit rejection: Google did not accept this request.
        throw new ServiceError(response.status === 401 || response.status === 403 ? 'send_permission_denied' : 'gmail_rejected')
      }
      throw new ServiceError('delivery_unknown')
    }
    const result = await response.json()
    if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(result.id)) throw new ServiceError('delivery_unknown')
    outcome = { status: 'sent', gmail_message_id: result.id }
  } catch (error) {
    outcome = { status: dispatched ? 'delivery_unknown' : 'failed', error_code: dispatched ? 'delivery_unknown' : error instanceof ServiceError ? error.code : 'request_failed' }
  }
  // A lost DB acknowledgement leaves 'sending'. Refresh resolves it to unknown,
  // never to retryable. No provider retry exists anywhere in this path.
  return command(db,owner,'finish',id,a.revision,{ ...outcome, attempt_id: a.attempt_id })
}
export async function applicationAction(db: SupabaseClient, owner: string, input: Record<string, unknown>, access: () => Promise<string>, transport: typeof fetch) {
  if (input.action === 'application_create') {
    if (!uuid(input.jobId)) throw new ServiceError('invalid_application')
    const [job,profile] = await Promise.all([
      db.from('imported_jobs').select('title').eq('owner_id',owner).eq('id',input.jobId).single(),
      db.from('owner_profiles').select('full_name').eq('owner_id',owner).maybeSingle(),
    ])
    if (job.error || profile.error) throw new ServiceError('database_error')
    const title = typeof job.data?.title === 'string' ? Array.from(job.data.title as string, c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c).join('').slice(0,175) : ''
    return command(db,owner,'create',null,null,{ job_id: input.jobId, subject: title ? `Application: ${title}` : 'Job application',
      body: `Hello,\n\nI would like to apply${title ? ` for ${title}` : ' for this position'}. Please find my resume attached for your review.\n\nThank you${profile.data?.full_name ? `,\n${profile.data.full_name}` : '.'}` })
  }
  if (!uuid(input.id) || !Number.isInteger(input.revision)) throw new ServiceError('invalid_application')
  const id = input.id, revision = input.revision as number
  switch (input.action) {
    case 'application_save': {
      if (typeof input.recipient !== 'string' || (input.recipient !== '' && !validRecipient(input.recipient)) || !validEmailText(input.subject,input.body)
        || typeof input.recipient_verified !== 'boolean' || (input.resume_id !== null && !uuid(input.resume_id))) throw new ServiceError('invalid_application')
      if (input.resume_id) {
        const r = await db.from('resumes').select('id').eq('owner_id',owner).eq('id',input.resume_id).eq('status','ready').single()
        if (r.error || !r.data) throw new ServiceError('resume_unavailable')
      }
      return command(db,owner,'save',id,revision,{ recipient: input.recipient, recipient_verified: input.recipient_verified, subject: input.subject, body: input.body, resume_id: input.resume_id })
    }
    case 'application_ready': {
      const a = await getApplication(db,owner,id)
      if (!validRecipient(a.recipient) || !a.recipient_verified || !validEmailText(a.subject,a.body)) throw new ServiceError('invalid_application')
      const attachment = await pdf(db,owner,a.resume_id)
      return command(db,owner,'ready',id,revision,{ resume_sha256: attachment.digest })
    }
    case 'application_send':
      if (input.confirmed !== true) throw new ServiceError('confirmation_required')
      return sendApplication(db,owner,id,revision,access,transport)
    case 'application_refresh': return command(db,owner,'stale',id,revision)
    case 'application_reconcile':
      if (!['sent','not_found'].includes(input.outcome as string) || typeof input.note !== 'string' || input.note.trim().length < 10 || input.note.length > 2000) throw new ServiceError('reconciliation_required')
      return command(db,owner,'reconcile',id,revision,{ outcome: input.outcome, note: input.note.trim() })
    case 'application_external':
      if (typeof input.sent_at !== 'string' || !Number.isFinite(Date.parse(input.sent_at)) || Date.parse(input.sent_at) > Date.now() || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 2000) throw new ServiceError('invalid_application')
      return command(db,owner,'external',id,revision,{ sent_at: input.sent_at, note: input.note.trim() })
    default: throw new ServiceError('invalid_action')
  }
}
