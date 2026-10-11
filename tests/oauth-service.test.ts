import { webcrypto } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiHandler, callbackHandler, completeOAuth } from '../supabase/functions/_shared/service'
import { gmailScope, hash, randomSecret } from '../supabase/functions/_shared/google'
const config = { appOrigin: 'https://app.example.invalid', google: { clientId: 'fixture', clientSecret: 'inert', encryptionKey: '', redirectUri: 'https://backend.example.invalid/functions/v1/gmail-callback' } }
function backend() {
  const intent = { owner_id: 'owner', generation: 'generation', expected_email: 'owner@example.invalid', verifier: 'fixture-verifier' }
  let consumed = false
  const rpc = vi.fn(async (name: string) => {
    if (name === 'consume_gmail_state') { const data = consumed ? [] : [intent]; consumed = true; return { data, error: null } }
    return { data: true, error: null }
  })
  const eq = vi.fn(() => ({ eq: async () => ({ error: null }) }))
  const update = vi.fn(() => ({ eq }))
  const auth = { getUser: vi.fn(async () => ({ data: { user: { id: 'owner' } }, error: null })) }
  return { db: { rpc, from: () => ({ update }), auth } as unknown as SupabaseClient, rpc, update, auth }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network prohibited') })); config.google.encryptionKey = randomSecret() })
afterEach(() => vi.unstubAllGlobals())
describe('Edge handler fixture tests', () => {
  it('atomically consumes state before exchanging code and rejects reuse', async () => {
    const api = backend(), state = randomSecret()
    const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'inert', refresh_token: 'inert-refresh', expires_in: 3600, scope: gmailScope })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: 'owner@example.invalid' })))
    const url = new URL(`${config.google.redirectUri}?state=${state}&code=inert-code`)
    await completeOAuth(api.db, url, config.google, transport)
    expect(api.rpc).toHaveBeenNthCalledWith(1, 'consume_gmail_state', { p_hash: await hash(state) })
    expect(api.rpc).toHaveBeenCalledWith('finish_gmail_oauth', expect.objectContaining({ p_owner: 'owner', p_email: 'owner@example.invalid', p_encrypted: expect.stringMatching(/^v1\./) }))
    await expect(completeOAuth(api.db, url, config.google, transport)).rejects.toThrow('invalid_state')
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('rejects expired or nonexistent state without contacting Google', async () => {
    const api = backend(); api.rpc.mockResolvedValueOnce({ data: [], error: null } as never)
    const transport = vi.fn()
    await expect(completeOAuth(api.db, new URL(`${config.google.redirectUri}?state=${randomSecret()}&code=inert`), config.google, transport)).rejects.toThrow('invalid_state')
    expect(transport).not.toHaveBeenCalled()
  })
  it('rejects wrong accounts without persisting credentials', async () => {
    const api = backend()
    const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'inert', refresh_token: 'inert-refresh', expires_in: 3600, scope: gmailScope })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: 'wrong@example.invalid' })))
    await expect(completeOAuth(api.db, new URL(`${config.google.redirectUri}?state=${randomSecret()}&code=inert`), config.google, transport)).rejects.toThrow('wrong_account')
    expect(api.rpc).not.toHaveBeenCalledWith('finish_gmail_oauth', expect.anything())
  })
  it('consumes denied consent and returns only a safe result to the fixed app origin', async () => {
    const api = backend()
    const response = await callbackHandler(api.db, config)(new Request(`${config.google.redirectUri}?state=${randomSecret()}&error=access_denied&redirect=https://evil.invalid`))
    expect(response.headers.get('location')).toBe('https://app.example.invalid/settings?gmail=consent_denied')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })
  it('requires a valid authenticated registered owner for all API actions', async () => {
    const api = backend(), handle = apiHandler(api.db, config)
    expect((await handle(new Request(config.appOrigin, { method: 'POST', body: '{"action":"manual"}' }))).status).toBe(401)
    api.rpc.mockResolvedValueOnce({ data: false, error: null } as never)
    const response = await handle(new Request(config.appOrigin, { method: 'POST', headers: { Authorization: 'Bearer inert' }, body: '{"action":"manual"}' }))
    expect(response.status).toBe(403)
    expect(api.auth.getUser).toHaveBeenCalledWith('inert')
  })
  it('rejects untrusted CORS origins and unsupported methods', async () => {
    const api = backend(), handle = apiHandler(api.db, config)
    expect((await handle(new Request(config.appOrigin, { method: 'POST', headers: { Origin: 'https://evil.invalid' } }))).status).toBe(403)
    expect((await handle(new Request(config.appOrigin))).status).toBe(405)
    expect(api.auth.getUser).not.toHaveBeenCalled()
  })
})
