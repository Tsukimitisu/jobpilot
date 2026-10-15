import type { SupabaseClient } from '@supabase/supabase-js'
import { applicationAction } from './applications.ts'
import { canonicalUrl, manualCandidate, validDate, type Candidate } from './discovery.ts'
import { parseJobAlert } from './alerts.ts'
import { connectorPage, discoveryTransport, ProviderError, adzunaMarkets, type AdzunaConfig } from './connectors.ts'
import { scoreSearch, validSearchProfile, type SearchProfile } from './search.ts'
import { authorizationUrl, decryptToken, encryptToken, gmailGet, gmailSendScope, googleTokens, hash, messageText, randomSecret, ServiceError, verifyGmailIdentity, type GmailPart, type GoogleConfig } from './google.ts'

export type BackendConfig = { appOrigin: string; google: GoogleConfig; adzuna?: AdzunaConfig }
type Connection = { owner_id: string; expected_email: string; generation: string; status: string; granted_scopes?: string[]; send_consented_at?: string | null }
type Source = { id: string; owner_id: string; kind: string; source_key: string; name: string; cursor: string | null; enabled: boolean; confirmed_email: string | null }
export const safeCode = (error: unknown) => error instanceof ServiceError ? error.code : 'request_failed'
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new ServiceError('database_error')
  return result.data
}
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>) { return checked(await db.rpc(name, args)) }
async function connection(db: SupabaseClient, owner: string): Promise<Connection> {
  const value = checked(await db.from('gmail_connections').select('*').eq('owner_id', owner).maybeSingle())
  if (!value) throw new ServiceError('gmail_disconnected')
  return value
}
async function markConnection(db: SupabaseClient, current: Connection, code: string | null) {
  checked(await db.from('gmail_connections').update({ status: code ? 'reconnect_required' : 'connected', error_code: code, checked_at: new Date().toISOString() })
    .eq('owner_id', current.owner_id).eq('generation', current.generation))
}
export async function gmailAccess(db: SupabaseClient, owner: string, config: GoogleConfig, transport: typeof fetch = fetch, send = false) {
  const current = await connection(db, owner)
  if (current.status === 'disconnected') throw new ServiceError('gmail_disconnected')
  if (send && (!current.send_consented_at || !current.granted_scopes?.includes(gmailSendScope))) throw new ServiceError('send_consent_required')
  const credential = checked(await db.from('gmail_credentials').select('*').eq('owner_id', owner).eq('generation', current.generation).maybeSingle())
  if (!credential) { await markConnection(db, current, 'reconnect_required'); throw new ServiceError('reconnect_required') }
  try {
    const refresh = await decryptToken(credential.encrypted_refresh_token, owner, config.encryptionKey)
    const tokens = await googleTokens(config, { grant_type: 'refresh_token', refresh_token: refresh }, transport, send)
    await verifyGmailIdentity(tokens.accessToken, current.expected_email, transport)
    if (tokens.refreshToken) checked(await db.from('gmail_credentials').update({ encrypted_refresh_token: await encryptToken(tokens.refreshToken, owner, config.encryptionKey) }).eq('owner_id', owner).eq('generation', current.generation))
    await markConnection(db, current, null)
    return tokens.accessToken
  } catch (error) {
    if (['reconnect_required', 'wrong_account', 'scope_mismatch'].includes(safeCode(error))) await markConnection(db, current, safeCode(error))
    throw error
  }
}
export async function beginOAuth(db: SupabaseClient, owner: string, email: unknown, config: GoogleConfig, send = false) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new ServiceError('invalid_email')
  if (!config.clientId || !config.clientSecret || !config.encryptionKey) throw new ServiceError('backend_configuration')
  await encryptToken('', owner, config.encryptionKey)
  const expected = email.trim().toLowerCase(), state = randomSecret(), verifier = randomSecret()
  await rpc(db, 'begin_gmail_oauth_v4', { p_owner: owner, p_email: expected, p_hash: await hash(state), p_verifier: verifier, p_send: send })
  return { url: authorizationUrl(config, state, await hash(verifier), expected, send) }
}
export async function completeOAuth(db: SupabaseClient, url: URL, config: GoogleConfig, transport: typeof fetch = fetch) {
  const state = url.searchParams.get('state')
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new ServiceError('invalid_state')
  const states = await rpc(db, 'consume_gmail_state_v4', { p_hash: await hash(state) })
  const intent = states?.[0]
  if (!intent) throw new ServiceError('invalid_state')
  // Failed/cancelled upgrades leave the active credential and connection intact.
  if (url.searchParams.has('error')) throw new ServiceError('consent_denied')
  const code = url.searchParams.get('code')
  if (!code || code.length > 4096) throw new ServiceError('token_failure')
  const tokens = await googleTokens(config, { grant_type: 'authorization_code', code, code_verifier: intent.verifier, redirect_uri: config.redirectUri }, transport, intent.requested_send === true)
  const email = await verifyGmailIdentity(tokens.accessToken, intent.expected_email, transport)
  if (!tokens.refreshToken) throw new ServiceError('offline_access_missing')
  const success = await rpc(db, 'finish_gmail_oauth_v4', { p_owner: intent.owner_id, p_generation: intent.generation, p_email: email,
    p_encrypted: await encryptToken(tokens.refreshToken, intent.owner_id, config.encryptionKey), p_scopes: tokens.scopes, p_send: intent.requested_send === true })
  if (!success) throw new ServiceError('invalid_state')
}
async function labels(db: SupabaseClient, owner: string, config: GoogleConfig, transport: typeof fetch) {
  const current = await connection(db, owner)
  try {
    const token = await gmailAccess(db, owner, config, transport)
    const data = await gmailGet('labels', token, transport)
    return (Array.isArray(data.labels) ? data.labels : []).filter((label: { type?: string }) => label.type === 'user') as { id: string; name: string }[]
  } catch (error) {
    if (safeCode(error) === 'reconnect_required') await markConnection(db, current, 'reconnect_required')
    throw error
  }
}
async function store(db: SupabaseClient, owner: string, source: string, external: string, job: unknown, origin: unknown) {
  return await rpc(db, 'store_job_candidate', { p_owner: owner, p_source: source, p_external: external, p_job: job, p_origin: origin }) === true
}
export async function importSource(db: SupabaseClient, owner: string, sourceId: string, config: GoogleConfig, transport: typeof fetch = fetch,
  scheduled?: { runId: string; deadline: number; guard: () => Promise<void> }, adzuna?: AdzunaConfig, workDeadline = Infinity) {
  const run = scheduled
    ? await rpc(db, 'start_scheduled_import', { p_run: scheduled.runId, p_source: sourceId })
    : await rpc(db, 'start_job_import', { p_owner: owner, p_source: sourceId })
  let source: Source | null = null
  let gmailConnection: Connection | null = null
  let added = 0, duplicates = 0, cursor: string | null = null
  let profiles: SearchProfile[] = []
  const deadline = Math.min(Date.now() + 90000, scheduled?.deadline ?? Infinity, workDeadline)
  const guard = async () => {
    if (Date.now() >= deadline) throw new ServiceError('interrupted')
    await scheduled?.guard()
    const current = checked(await db.from('job_sources').select('*').eq('id', sourceId).eq('owner_id', owner).single())
    if (!current?.enabled || (source && current.source_key !== source.source_key)) throw new ServiceError('source_paused')
    if (Date.now() >= deadline) throw new ServiceError('interrupted')
  }
  const provider: typeof fetch = discoveryTransport(async (input, init) => {
    await guard()
    if (await rpc(db,'source_provider_ready',{p_owner:owner,p_source:sourceId})===false) throw new ServiceError('rate_limited')
    return transport(input, init)
  })
  const save = async (external: string, job: Candidate, origin: unknown, checkpoint: string | null) => {
    await guard()
    const fresh=await rpc(db, 'store_import_candidate', { p_owner: owner, p_run: run.id, p_external: external, p_job: { ...job, profile_matches: profiles.map(p => scoreSearch(job,p)) }, p_origin: origin }) === true
    await rpc(db,'checkpoint_import',{p_owner:owner,p_run:run.id,p_cursor:checkpoint})
    return fresh
  }
  try {
    source = checked(await db.from('job_sources').select('*').eq('id', sourceId).eq('owner_id', owner).single())
    if (!source) throw new ServiceError('invalid_source')
    const profileRows = checked(await db.from('search_profiles').select('*').eq('owner_id',owner).eq('enabled',true))
    profiles = Array.isArray(profileRows) ? profileRows : []
    const limit = profiles.length ? Math.min(...profiles.map(p=>p.results_limit)) : 50
    if (source.kind === 'gmail') {
      gmailConnection = await connection(db, owner)
      if (source.confirmed_email !== gmailConnection.expected_email) throw new ServiceError('label_confirmation_required')
      const token = await gmailAccess(db, owner, config, provider)
      if ((await connection(db, owner)).generation !== gmailConnection.generation) throw new ServiceError('interrupted')
      const params = new URLSearchParams({ labelIds: source.source_key, maxResults: '10', includeSpamTrash: 'false' })
      let checkpoint = { token: source.cursor ?? '', message: 0, job: 0 }
      if (source.cursor?.startsWith('{')) {
        try { checkpoint=JSON.parse(source.cursor) } catch { throw new ServiceError('invalid_cursor') }
      }
      if (checkpoint.token) params.set('pageToken', checkpoint.token)
      const page = await gmailGet(`messages?${params}`, token, provider)
      cursor = typeof page.nextPageToken === 'string' ? page.nextPageToken : null
      const messages=(Array.isArray(page.messages) ? page.messages.slice(0, 10) : []) as { id: string }[]
      outer: for (let messageIndex=checkpoint.message;messageIndex<messages.length;messageIndex++) {
        const item=messages[messageIndex]
        if (Date.now() > deadline) throw new ServiceError('interrupted')
        if ((await connection(db, owner)).generation !== gmailConnection.generation) throw new ServiceError('interrupted')
        const message = await gmailGet(`messages/${encodeURIComponent(item.id)}?format=full`, token, provider)
        if (!Array.isArray(message.labelIds) || !message.labelIds.includes(source.source_key)) continue
        const payload = (message.payload ?? {}) as GmailPart
        const sender = payload.headers?.find(header => header.name.toLowerCase() === 'from')?.value.slice(0, 1000) ?? null
        const sourceDate = validDate(Number(message.internalDate))
        const jobs = parseJobAlert(messageText(payload), sender)
        for (let jobIndex=messageIndex===checkpoint.message ? checkpoint.job : 0;jobIndex<jobs.length;jobIndex++) {
          if (added+duplicates>=limit) { cursor=JSON.stringify({token:checkpoint.token,message:messageIndex,job:jobIndex}); break outer }
          const job=jobs[jobIndex]
          const fresh = await save(`${item.id}:${job.canonical_url ?? 'review'}`, job, {
            message_id: item.id, sender, source_date: sourceDate,
            source_url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(gmailConnection.expected_email)}#all/${encodeURIComponent(item.id)}`,
          },JSON.stringify({token:checkpoint.token,message:messageIndex,job:jobIndex+1}))
          if (fresh) added++; else duplicates++
        }
      }
    } else if (['greenhouse','lever','ashby','adzuna'].includes(source.kind)) {
      const page = await connectorPage(source,limit,profiles,adzuna,provider)
      cursor = page.cursor
      for (const item of page.jobs) {
        if (Date.now() > deadline) throw new ServiceError('interrupted')
        const job = item.job
        const fresh = await save(item.external, job, { source_date: job.published_at, source_url: job.canonical_url },item.checkpoint??null)
        if (fresh) added++; else duplicates++
      }
    } else throw new ServiceError('invalid_source')
    await guard()
    await rpc(db, 'finish_job_import', { p_owner: owner, p_run: run.id, p_error: null, p_cursor: cursor, p_added: added, p_duplicates: duplicates })
    return { added, duplicates, more: !!cursor }
  } catch (error) {
    if (gmailConnection && safeCode(error) === 'reconnect_required') await markConnection(db, gmailConnection, 'reconnect_required')
    if (safeCode(error)==='rate_limited' || error instanceof ProviderError && error.retryAt) await rpc(db,'provider_backoff',{p_owner:owner,p_run:run.id,p_retry_at:error instanceof ProviderError?error.retryAt:null})
    await rpc(db,'source_backoff',{ p_owner:owner,p_run:run.id,p_retry_at:error instanceof ProviderError ? error.retryAt : null })
    await rpc(db, 'finish_job_import', { p_owner: owner, p_run: run.id, p_error: safeCode(error), p_cursor: null, p_added: added, p_duplicates: duplicates })
    throw error
  }
}
export async function apiAction(db: SupabaseClient, owner: string, input: Record<string, unknown>, config: BackendConfig, transport: typeof fetch = fetch): Promise<unknown> {
  if (typeof input.action === 'string' && input.action.startsWith('application_')) return applicationAction(db, owner, input, () => gmailAccess(db, owner, config.google, transport, true), transport)
  switch (input.action) {
    case 'run_discovery': {
      const claim=await rpc(db,'claim_manual_discovery',{p_owner:owner})
      if (!claim) throw new ServiceError('import_busy')
      const results: {source_id:string;added?:number;duplicates?:number;error?:string}[]=[]
      const deadline=Date.now()+100000
      let requests=0
      const bounded: typeof fetch=async (url,init)=>{
        if (++requests>40 || Date.now()>=deadline) throw new ServiceError('interrupted')
        return transport(url,{...init,signal:AbortSignal.any([init?.signal ?? new AbortController().signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))])})
      }
      try {
        for (const id of claim.sources as string[]) {
          if (Date.now()>=deadline) break
          try { results.push({source_id:id,...await importSource(db,owner,id,config.google,bounded,undefined,config.adzuna,deadline)}) }
          catch(error) { results.push({source_id:id,error:safeCode(error)}) }
        }
        return {results}
      } finally { await rpc(db,'finish_manual_discovery',{p_owner:owner,p_id:claim.id}) }
    }
    case 'discovery_configuration': return { adzuna: config.adzuna?.appId && config.adzuna.appKey ? 'Configured' : 'Not configured' }
    case 'save_search_profile': {
      if (!validSearchProfile(input.profile)) throw new ServiceError('invalid_search_profile')
      const { id, ...profile } = input.profile
      // Whitelist fields; do not let an authenticated request assign owner_id or metadata.
      const values = Object.fromEntries(['name','desired_titles','alternative_titles','required_keywords','excluded_keywords','locations','work_modes','employment_types','max_experience','minimum_salary','results_limit','enabled'].map(k=>[k,profile[k as keyof typeof profile]]))
      if (id) checked(await db.from('search_profiles').update(values).eq('owner_id',owner).eq('id',id).select('id').single())
      else checked(await db.from('search_profiles').insert({...values,owner_id:owner}))
      return {ok:true}
    }
    case 'delete_search_profile': {
      if (typeof input.id !== 'string') throw new ServiceError('invalid_search_profile')
      checked(await db.from('search_profiles').delete().eq('owner_id',owner).eq('id',input.id))
      return {ok:true}
    }
    case 'add_source': {
      const kind=String(input.kind), board=typeof input.board==='string' ? input.board.trim() : ''
      if (!['greenhouse','lever','ashby','adzuna'].includes(kind) || (kind==='adzuna' ? !adzunaMarkets.includes(board) : !/^[a-zA-Z0-9_-]{1,100}$/.test(board))) throw new ServiceError('invalid_source')
      checked(await db.from('job_sources').upsert({owner_id:owner,kind,source_key:board,name:`${kind}: ${board}`,enabled:false,removed_at:null,cursor:null},{onConflict:'owner_id,kind,source_key'}))
      return {ok:true}
    }
    case 'remove_source': {
      if (typeof input.sourceId!=='string') throw new ServiceError('invalid_source')
      await rpc(db,'remove_discovery_source',{p_owner:owner,p_source:input.sourceId}); return {ok:true}
    }
    case 'test_source': {
      if (typeof input.sourceId!=='string') throw new ServiceError('invalid_source')
      const run=await rpc(db,'claim_source_test',{p_owner:owner,p_source:input.sourceId})
      try {
        const testDeadline=Date.now()+40000
        const testTransport:typeof fetch=discoveryTransport(async(url,init)=>{
          if(Date.now()>=testDeadline)throw new ServiceError('interrupted')
          if(await rpc(db,'source_provider_ready',{p_owner:owner,p_source:input.sourceId})===false)throw new ServiceError('rate_limited')
          return transport(url,{...init,signal:AbortSignal.any([init?.signal??new AbortController().signal,AbortSignal.timeout(Math.max(1,testDeadline-Date.now()))])})
        })
        const source=checked(await db.from('job_sources').select('*').eq('owner_id',owner).eq('id',input.sourceId).single())
        let preview: unknown
        if (source.kind==='gmail') {
          const available=await labels(db,owner,config.google,testTransport)
          if (!available.some(v=>v.id===source.source_key)) throw new ServiceError('invalid_label')
          preview={company:null,titles:[],board:source.name}
        } else {
          const profiles=checked(await db.from('search_profiles').select('*').eq('owner_id',owner).eq('enabled',true)) ?? []
          const page=await connectorPage({...source,cursor:null},3,profiles,config.adzuna,testTransport)
          preview={company:page.company,titles:page.jobs.map(j=>j.job.title),board:source.source_key}
        }
        await rpc(db,'finish_source_test',{p_owner:owner,p_run:run.id,p_error:null})
        return preview
      } catch(error) {
        if (safeCode(error)==='rate_limited' || error instanceof ProviderError && error.retryAt) await rpc(db,'provider_backoff',{p_owner:owner,p_run:run.id,p_retry_at:error instanceof ProviderError?error.retryAt:null})
        await rpc(db,'source_backoff',{p_owner:owner,p_run:run.id,p_retry_at:error instanceof ProviderError ? error.retryAt : null})
        await rpc(db,'finish_source_test',{p_owner:owner,p_run:run.id,p_error:safeCode(error)})
        throw error
      }
    }
    case 'set_automation': {
      if (typeof input.enabled !== 'boolean') throw new ServiceError('invalid_action')
      await rpc(db, 'set_discovery_automation', { p_owner: owner, p_enabled: input.enabled })
      return { ok: true }
    }
    case 'connect': return beginOAuth(db, owner, input.email, config.google)
    case 'connect_send': return beginOAuth(db, owner, input.email, config.google, true)
    case 'disconnect': await rpc(db, 'disconnect_gmail_v4', { p_owner: owner }); return { ok: true }
    case 'check_gmail': await gmailAccess(db, owner, config.google, transport); return { ok: true }
    case 'labels': return { labels: await labels(db, owner, config.google, transport) }
    case 'save_gmail_label': {
      const available = await labels(db, owner, config.google, transport)
      const selected = available.find(label => label.id === input.labelId)
      if (!selected) throw new ServiceError('invalid_label')
      await rpc(db, 'set_gmail_label', { p_owner: owner, p_label: selected.id, p_name: selected.name })
      return { ok: true }
    }
    case 'add_greenhouse': {
      const board = typeof input.board === 'string' ? input.board.trim() : ''
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(board)) throw new ServiceError('invalid_source')
      checked(await db.from('job_sources').upsert({ owner_id: owner, kind: 'greenhouse', source_key: board, name: board, enabled: false }, { onConflict: 'owner_id,kind,source_key' }))
      return { ok: true }
    }
    case 'toggle_source': {
      if (typeof input.enabled !== 'boolean' || typeof input.sourceId !== 'string') throw new ServiceError('invalid_source')
      if (input.enabled) {
        const source = checked(await db.from('job_sources').select('*').eq('owner_id', owner).eq('id', input.sourceId).single())
        if (source.removed_at) throw new ServiceError('invalid_source')
        if (source.kind === 'gmail' && source.confirmed_email !== (await connection(db, owner)).expected_email) throw new ServiceError('label_confirmation_required')
      }
      checked(await db.from('job_sources').update({ enabled: input.enabled }).eq('owner_id', owner).eq('id', input.sourceId))
      return { ok: true }
    }
    case 'import': {
      if (typeof input.sourceId !== 'string') throw new ServiceError('invalid_source')
      return importSource(db, owner, input.sourceId, config.google, transport, undefined, config.adzuna)
    }
    case 'manual': {
      for (const field of ['url', 'description', 'title', 'company', 'location', 'work_mode']) if (input[field] !== undefined && typeof input[field] !== 'string') throw new ServiceError('invalid_job')
      const values = input as Record<string, string>
      if ((!values.url?.trim() && !values.description?.trim()) || (values.url && !canonicalUrl(values.url)) || (values.description?.length ?? 0) > 50000) throw new ServiceError('invalid_job')
      const job = manualCandidate(values)
      const source = checked(await db.from('job_sources').upsert({ owner_id: owner, kind: 'manual', source_key: 'manual', name: 'Manual entry' }, { onConflict: 'owner_id,kind,source_key' }).select('id').single())
      if (!source) throw new ServiceError('database_error')
      const external = await hash(JSON.stringify([job.canonical_url, job.title, job.description]))
      const added = await store(db, owner, source.id, external, job, { source_url: job.canonical_url })
      return { added }
    }
    default: throw new ServiceError('invalid_action')
  }
}
export async function authorizeOwner(db: SupabaseClient, request: Request) {
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if (!token) throw new ServiceError('unauthorized')
  const result = await db.auth.getUser(token)
  if (result.error || !result.data.user) throw new ServiceError('unauthorized')
  const owner = result.data.user.id
  const access = await db.rpc('phase3_is_owner', { p_owner: owner })
  if (access.error || access.data !== true) throw new ServiceError('owner_required')
  return owner
}
export function apiHandler(db: SupabaseClient, config: BackendConfig, transport: typeof fetch = fetch) {
  return async (request: Request) => {
    const headers = { 'Access-Control-Allow-Origin': config.appOrigin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Content-Type': 'application/json' }
    if (request.headers.get('Origin') && request.headers.get('Origin') !== config.appOrigin) return new Response(null, { status: 403, headers })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return new Response(null, { status: 405, headers })
    try {
      const owner = await authorizeOwner(db, request)
      const body = await request.text()
      if (body.length > 60000) throw new ServiceError('invalid_job')
      let input: Record<string, unknown>
      try { input = JSON.parse(body) } catch { throw new ServiceError('invalid_action') }
      if (!input || Array.isArray(input) || typeof input !== 'object') throw new ServiceError('invalid_action')
      return new Response(JSON.stringify(await apiAction(db, owner, input, config, transport)), { headers })
    } catch (error) {
      const code = safeCode(error)
      return new Response(JSON.stringify({ error: code }), { status: code === 'unauthorized' ? 401 : code === 'owner_required' ? 403 : 400, headers })
    }
  }
}
export function callbackHandler(db: SupabaseClient, config: BackendConfig, transport: typeof fetch = fetch) {
  return async (request: Request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    let result = 'connected'
    try { await completeOAuth(db, new URL(request.url), config.google, transport) } catch (error) { result = safeCode(error) }
    return new Response(null, { status: 303, headers: { Location: `${config.appOrigin}/settings?gmail=${encodeURIComponent(result)}`,
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'" } })
  }
}
