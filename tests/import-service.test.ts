import { webcrypto } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gmailAccess, importSource } from '../supabase/functions/_shared/service'
import { encryptToken, randomSecret, type GoogleConfig } from '../supabase/functions/_shared/google'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
async function backend(kind = 'gmail') {
  const config: GoogleConfig = { clientId: 'fixture', clientSecret: 'inert-secret', redirectUri: 'https://example.invalid/callback', encryptionKey: randomSecret() }
  const connection = { owner_id: 'owner', generation: 'g', status: 'connected', expected_email: 'owner@example.invalid' }
  const credential = { generation: 'g', encrypted_refresh_token: await encryptToken('inert-refresh', 'owner', config.encryptionKey) }
  const source = { id: 'source', owner_id: 'owner', kind, source_key: kind === 'gmail' ? 'Label_fixture' : 'fixture', cursor: null as string|null, enabled: true, confirmed_email: 'owner@example.invalid' }
  const stored = new Map<string, unknown>()
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'start_job_import') return { data: { id: 'run' }, error: null }
    if (name === 'checkpoint_import')source.cursor=args.p_cursor as string|null
    if (name === 'finish_job_import' && !args.p_error)source.cursor=args.p_cursor as string|null
    if (name === 'store_import_candidate') {
      const key = args.p_external as string, fresh = !stored.has(key)
      if (fresh) stored.set(key, args)
      return { data: fresh, error: null }
    }
    return { data: null, error: null }
  })
  const from = (table: string) => {
    let update: Record<string, unknown> | undefined
    const value = table === 'gmail_connections' ? connection : table === 'gmail_credentials' ? credential : source
    const query = {
      select: () => query, eq: () => query,
      single: async () => ({ data: value, error: null }), maybeSingle: async () => ({ data: value, error: null }),
      update: (patch: Record<string, unknown>) => { update = patch; return query },
      then: (resolve: (result: unknown) => unknown) => { if (update) Object.assign(value, update); return Promise.resolve({ data: value, error: null }).then(resolve) },
    }
    return query
  }
  return { db: { from, rpc } as unknown as SupabaseClient, config, connection, source, stored, rpc }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network prohibited') })) })
afterEach(() => vi.unstubAllGlobals())

describe('fixture-only imports and credential lifecycle', () => {
  it('resumes after the last committed candidate when an import fails mid-page',async()=>{
    const api=await backend('greenhouse'), original=api.rpc.getMockImplementation()!
    let fail=true
    api.rpc.mockImplementation(async(name,args)=>{
      if(name==='store_import_candidate' && args.p_external==='2' && fail){fail=false;return {data:null,error:{message:'synthetic database failure'}}}
      return original(name,args)
    })
    const transport=vi.fn(async(input)=>String(input).endsWith('content=true')?json({jobs:[1,2,3].map(id=>({id,title:`Job ${id}`,content:'Fixture',absolute_url:`https://example.invalid/${id}`}))}):json({name:'Fixture'}))
    await expect(importSource(api.db,'owner','source',api.config,transport)).rejects.toThrow('database_error')
    expect(api.source.cursor).toBe('1');expect(api.stored.size).toBe(1)
    expect(await importSource(api.db,'owner','source',api.config,transport)).toMatchObject({added:2,duplicates:0,more:false})
    expect(api.source.cursor).toBeNull();expect(api.stored.size).toBe(3)
  })
  it('reads only the selected Gmail label, skips moved messages, preserves provenance, and repeats safely', async () => {
    const api = await backend()
    const transport = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: 'inert', expires_in: 3600 })
      if (url.pathname.endsWith('/profile')) return json({ emailAddress: 'owner@example.invalid' })
      if (url.pathname.endsWith('/messages')) { expect(url.searchParams.get('labelIds')).toBe('Label_fixture'); return json({ messages: [{ id: 'message' }, { id: 'moved' }] }) }
      if (url.pathname.endsWith('/messages/moved')) return json({ labelIds: ['INBOX'], payload: {} })
      if (url.pathname.endsWith('/messages/message')) return json({ labelIds: ['Label_fixture'], internalDate: '1767225600000', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'fixture@example.invalid' }], body: { data: Buffer.from('Ambiguous alert: https://example.invalid/1 https://example.invalid/2').toString('base64url') } } })
      throw new Error('Unexpected provider route')
    })
    expect(await importSource(api.db, 'owner', 'source', api.config, transport)).toEqual({ added: 1, duplicates: 0, more: false })
    expect(await importSource(api.db, 'owner', 'source', api.config, transport)).toEqual({ added: 0, duplicates: 1, more: false })
    expect(api.stored.size).toBe(1)
    expect(api.stored.get('message:review')).toMatchObject({ p_job: { title: null, company: null, canonical_url: null }, p_origin: { message_id: 'message', sender: 'fixture@example.invalid', source_date: '2026-01-01T00:00:00.000Z' } })
  })
  it('uses only the explicitly configured Greenhouse public GET endpoints and flattens HTML', async () => {
    const api = await backend('greenhouse')
    const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method ?? 'GET').toBe('GET')
      expect(String(input)).toMatch(/^https:\/\/boards-api.greenhouse.io\/v1\/boards\/fixture/)
      return String(input).endsWith('content=true') ? json({ jobs: [{ id: 42, title: 'Fixture Engineer', content: '<p>Required skills: React</p><script>steal()</script>', absolute_url: 'https://example.invalid/42', location: { name: 'London' } }] }) : json({ name: 'Fixture Company' })
    })
    expect((await importSource(api.db, 'owner', 'source', api.config, transport)).added).toBe(1)
    expect(api.stored.get('42')).toMatchObject({ p_job: { title: 'Fixture Engineer', company: 'Fixture Company', description: 'Required skills: React' } })
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('refreshes on every operation, so expired access tokens are never reused', async () => {
    const api = await backend()
    const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/token')) { expect(String(init?.body)).toContain('grant_type=refresh_token'); return json({ access_token: 'fresh-inert', expires_in: 3600 }) }
      return json({ emailAddress: 'owner@example.invalid' })
    })
    await gmailAccess(api.db, 'owner', api.config, transport)
    await gmailAccess(api.db, 'owner', api.config, transport)
    expect(transport.mock.calls.filter(([url]) => String(url).includes('/token'))).toHaveLength(2)
  })
  it('marks revoked access as reconnect required and records a failed import without discarding jobs', async () => {
    const api = await backend()
    const transport = vi.fn(async () => json({ error: 'invalid_grant' }, 400))
    await expect(importSource(api.db, 'owner', 'source', api.config, transport)).rejects.toThrow('reconnect_required')
    expect(api.connection.status).toBe('reconnect_required')
    expect(api.rpc).toHaveBeenCalledWith('finish_job_import', expect.objectContaining({ p_error: 'reconnect_required' }))
    expect(api.rpc).not.toHaveBeenCalledWith('store_import_candidate', expect.anything())
  })
  it('does not mislabel outages as disconnection', async () => {
    const api = await backend()
    await expect(gmailAccess(api.db, 'owner', api.config, vi.fn(async () => json({}, 503)))).rejects.toThrow('provider_unavailable')
    expect(api.connection.status).toBe('connected')
  })
})
