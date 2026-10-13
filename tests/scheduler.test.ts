import { createHmac, webcrypto } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schedulerHandler } from '../supabase/functions/_shared/scheduler'
import { apiAction, type BackendConfig } from '../supabase/functions/_shared/service'
import { encryptToken, randomSecret } from '../supabase/functions/_shared/google'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const sign = (secret: string, time = Math.floor(Date.now() / 1000), purpose = 'jobpilot-discovery-v1') => `${time}.${createHmac('sha256', secret).update(`${purpose}:${time}`).digest('hex')}`
async function fixture(kind = 'greenhouse') {
  const secret = randomSecret()
  const config: BackendConfig = { appOrigin: 'https://example.invalid', google: { clientId: 'fixture', clientSecret: 'inert', encryptionKey: randomSecret(), redirectUri: 'https://example.invalid/callback' } }
  const state = { enabled: false, due: true, active: false, count: 0, runStatus: 'running' }
  const source = { id: 'source', owner_id: 'owner', source_key: kind === 'gmail' ? 'Label_confirmed' : 'confirmed', kind, enabled: true, cursor: null as string | null, confirmed_email: 'owner@example.invalid' }
  const connection = { owner_id: 'owner', expected_email: 'owner@example.invalid', generation: 'generation', status: 'connected' }
  const credential = { encrypted_refresh_token: await encryptToken('fixture', 'owner', config.google.encryptionKey) }
  const jobs = new Map<string, unknown>()
  const finishes: Record<string, unknown>[] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    if (name === 'discovery_automation_active') return { data: state.enabled && state.active && state.runStatus === 'running', error: null }
    if (name === 'set_discovery_automation') { state.enabled = args.p_enabled === true; return { data: null, error: null } }
    if (name === 'claim_discovery_automation') {
      if (!state.enabled || !state.due || state.active) return { data: null, error: null }
      state.active = true; state.due = false; state.count++; state.runStatus = 'running'
      return { data: { id: 'schedule', owner_id: 'owner' }, error: null }
    }
    if (name === 'scheduled_discovery_sources') return { data: source.enabled ? [source] : [], error: null }
    if (name === 'start_scheduled_import') return { data: { id: 'import' }, error: null }
    if (name === 'store_import_candidate') {
      const key = String(args.p_external), added = !jobs.has(key)
      if (added) jobs.set(key, args.p_job)
      return { data: added, error: null }
    }
    if (name === 'finish_job_import') { finishes.push(args); if (!args.p_error) source.cursor = args.p_cursor as string | null }
    if (name === 'finish_discovery_automation') { finishes.push(args); state.active = false; state.runStatus = String(args.p_status) }
    return { data: null, error: null }
  })
  const from = (table: string) => {
    let patch: Record<string, unknown> | undefined
    const data = () => table === 'job_sources' ? source : table === 'discovery_automation' ? state : table === 'automation_runs'
      ? { status: state.runStatus, lease_until: new Date(Date.now() + 180000).toISOString() } : table === 'gmail_connections' ? connection : credential
    const query = { select: () => query, eq: () => query, single: async () => ({ data: data(), error: null }), maybeSingle: async () => ({ data: data(), error: null }),
      update: (value: Record<string, unknown>) => { patch = value; return query },
      then: (resolve: (v: unknown) => unknown) => { if (patch) Object.assign(data(), patch); return Promise.resolve({ data: data(), error: null }).then(resolve) } }
    return query
  }
  const db = { rpc, from } as unknown as SupabaseClient
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    if (url.hostname === 'boards-api.greenhouse.io') {
      expect(url.pathname).toMatch(/^\/v1\/boards\/confirmed(?:\/jobs)?$/)
      expect(init?.method ?? 'GET').toBe('GET')
      return url.pathname.endsWith('/jobs') ? json({ jobs: Array.from({ length: 55 }, (_, i) => ({ id: i + 1, title: 'Fixture', content: 'Test', absolute_url: `https://example.invalid/${i + 1}` })) }) : json({ name: 'Fixture board' })
    }
    if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: 'fixture', expires_in: 3600 })
    if (url.pathname.endsWith('/profile')) return json({ emailAddress: connection.expected_email })
    if (url.pathname.endsWith('/messages')) {
      expect(url.searchParams.get('labelIds')).toBe('Label_confirmed')
      expect(url.searchParams.get('maxResults')).toBe('10')
      expect(url.searchParams.has('q')).toBe(false)
      return json({ messages: [{ id: 'fixture' }, { id: 'moved' }], nextPageToken: source.cursor ? undefined : 'page2' })
    }
    if (url.pathname.endsWith('/messages/moved')) return json({ labelIds: ['INBOX'] })
    if (url.pathname.endsWith('/messages/fixture')) return json({ labelIds: ['Label_confirmed'], payload: { mimeType: 'text/plain', body: { data: Buffer.from('Title: Fixture\nhttps://example.invalid/job').toString('base64url') } } })
    throw new Error('Unexpected provider route; sends are prohibited')
  })
  const call = (token = sign(secret), body: unknown = {}) => schedulerHandler(db, config, secret, transport)(new Request('https://example.invalid/scheduler', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }))
  const tick = async () => { state.due = true; return call() }
  return { state, secret, config, db, source, connection, rpc, jobs, finishes, transport, call, tick }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network prohibited') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('scheduled discovery with mocked providers only', () => {
  it('rejects missing, wrong, user JWT, and service-role-shaped credentials before database access', async () => {
    const f = await fixture()
    for (const token of ['', 'wrong', randomSecret(), 'eyJ.user.jwt', 'eyJ.service.role']) expect((await f.call(token)).status).toBe(401)
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled()
    const handler = schedulerHandler(f.db, f.config, '', f.transport)
    expect((await handler(new Request('https://example.invalid', { method: 'POST' }))).status).toBe(503)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('rejects expired, future, wrong-purpose and wrong-key signatures, including the raw secret', async () => {
    const f = await fixture(), now = Math.floor(Date.now() / 1000)
    for (const token of [sign(f.secret, now - 301), sign(f.secret, now + 31), sign(f.secret, now, 'application-send'), sign(randomSecret()), f.secret]) {
      expect((await f.call(token)).status).toBe(401)
    }
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('defaults off, honors pause/resume and ignores forged owner/action/source fields', async () => {
    const f = await fixture()
    expect(await (await f.call()).json()).toEqual({ status: 'skipped' })
    await apiAction(f.db, 'owner', { action: 'set_automation', enabled: true, owner_id: 'attacker' }, f.config, f.transport)
    expect(f.rpc).toHaveBeenCalledWith('set_discovery_automation', { p_owner: 'owner', p_enabled: true })
    expect(await (await f.call(undefined, { owner_id: 'attacker', action: 'application_send', sourceId: 'unconfirmed' })).json()).toMatchObject({ status: 'succeeded' })
    expect(f.rpc).toHaveBeenCalledWith('start_scheduled_import', { p_run: 'schedule', p_source: 'source' })
    await apiAction(f.db, 'owner', { action: 'set_automation', enabled: false }, f.config, f.transport)
    expect(await (await f.tick()).json()).toEqual({ status: 'skipped' })
    expect(f.transport).toHaveBeenCalledTimes(2)
  })
  it('continues the 50-job Greenhouse cursor and deduplicates subsequent full passes', async () => {
    const f = await fixture(); f.state.enabled = true
    await f.call(); expect(f.jobs.size).toBe(50); expect(f.source.cursor).toBe('50')
    await f.tick(); expect(f.jobs.size).toBe(55); expect(f.source.cursor).toBeNull()
    await f.tick(); expect(f.jobs.size).toBe(55)
    expect(f.finishes.at(-2)).toMatchObject({ p_added: 0, p_duplicates: 50 })
  })
  it('does not overlap or rerun an already claimed hourly slot', async () => {
    const f = await fixture(); f.state.enabled = true
    const results = await Promise.all([f.call(), f.call(), f.call()])
    const bodies = await Promise.all(results.map(result => result.json()))
    expect(bodies.filter(result => result.status === 'skipped')).toHaveLength(2)
    expect(f.state.count).toBe(1); expect(f.transport).toHaveBeenCalledTimes(2)
    expect(await (await f.call()).json()).toEqual({ status: 'skipped' })
  })
  it('skips disabled sources without any provider requests', async () => {
    const f = await fixture(); f.state.enabled = true; f.source.enabled = false
    await f.call(); expect(f.transport).not.toHaveBeenCalled()
  })
  it('stops writes when paused in flight and retains its cursor for safe retry', async () => {
    const f = await fixture(); f.state.enabled = true; f.source.cursor = '50'
    f.transport.mockImplementation(async () => { f.state.enabled = false; return json({ jobs: [] }) })
    await f.call()
    expect(f.jobs.size).toBe(0); expect(f.source.cursor).toBe('50')
    expect(f.finishes.at(-1)).toMatchObject({ p_status: 'paused', p_error: 'automation_paused' })
  })
  it('records provider failures and retries on a later tick without clearing jobs', async () => {
    const f = await fixture(); f.state.enabled = true
    f.transport.mockImplementationOnce(async () => json({}, 429))
    await f.call(); expect(f.finishes.at(-1)).toMatchObject({ p_status: 'failed', p_error: 'rate_limited' })
    expect(f.source.cursor).toBeNull()
    await f.tick(); expect(f.jobs.size).toBe(50)
  })
  it('uses only the confirmed Gmail label, checks message membership, continues cursors and deduplicates', async () => {
    const f = await fixture('gmail'); f.state.enabled = true
    await f.call(); expect(f.jobs.size).toBe(1); expect(f.source.cursor).toBe('page2')
    await f.tick(); expect(f.jobs.size).toBe(1); expect(f.source.cursor).toBeNull()
    expect(f.transport.mock.calls.some(([url]) => String(url).includes('pageToken=page2'))).toBe(true)
  })
  it('records expired grants as failed/Reconnect required and preserves existing jobs', async () => {
    const f = await fixture('gmail'); f.state.enabled = true
    await f.call()
    f.transport.mockImplementation(async () => json({ error: 'invalid_grant' }, 400))
    await f.tick()
    expect(f.connection.status).toBe('reconnect_required'); expect(f.jobs.size).toBe(1)
    expect(f.finishes.at(-1)).toMatchObject({ p_status: 'failed', p_error: 'reconnect_required' })
    expect(f.source.cursor).toBe('page2')
  })
  it('requires reconfirmation after switching mailboxes, before making any provider call', async () => {
    const f = await fixture('gmail'); f.state.enabled = true; f.source.confirmed_email = 'old@example.invalid'
    await f.call()
    expect(f.transport).not.toHaveBeenCalled()
    expect(f.finishes.at(-1)).toMatchObject({ p_status: 'failed', p_error: 'label_confirmation_required' })
  })
  it('bounds runtime, stopping before the next provider request after the deadline', async () => {
    const f = await fixture('gmail'); f.state.enabled = true
    const now = Date.now(); let clock = now
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    f.transport.mockImplementation(async () => { clock += 101000; return json({ access_token: 'fixture', expires_in: 3600 }) })
    await f.call(); expect(f.transport).toHaveBeenCalledTimes(1)
    expect(f.finishes.at(-1)).toMatchObject({ p_status: 'failed', p_error: 'interrupted' })
  })
})
