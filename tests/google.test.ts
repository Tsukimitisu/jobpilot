import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authorizationUrl, decryptToken, encryptToken, gmailScope, googleTokens, hash, messageText, randomSecret, verifyGmailIdentity } from '../supabase/functions/_shared/google'
const config = { clientId: 'fixture-client', clientSecret: 'fixture-secret', redirectUri: 'https://example.invalid/functions/v1/gmail-callback', encryptionKey: '' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network prohibited') })) })
afterEach(() => vi.unstubAllGlobals())
describe('Gmail OAuth with inert fixtures, not live Google', () => {
  it('requests offline read-only access, PKCE and a random state without secrets', async () => {
    const state = randomSecret(), verifier = randomSecret()
    expect(state).not.toBe(randomSecret()); expect(state.length).toBe(43)
    const url = new URL(authorizationUrl(config, state, await hash(verifier), 'owner@example.invalid'))
    expect(url.searchParams.get('scope')).toBe(gmailScope)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.href).not.toContain(config.clientSecret)
  })
  it('encrypts refresh tokens with randomized authenticated encryption bound to the owner', async () => {
    const secret = randomSecret()
    const first = await encryptToken('inert-token', 'owner', secret)
    expect(first).not.toContain('inert-token'); expect(first).not.toBe(await encryptToken('inert-token', 'owner', secret))
    expect(await decryptToken(first, 'owner', secret)).toBe('inert-token')
    await expect(decryptToken(first, 'other', secret)).rejects.toThrow()
    await expect(decryptToken(first, 'owner', randomSecret())).rejects.toThrow()
  })
  it('rejects the wrong mailbox even when Google succeeds', async () => {
    const transport = vi.fn().mockResolvedValue(response({ emailAddress: 'other@example.invalid' }))
    await expect(verifyGmailIdentity('inert-access', 'owner@example.invalid', transport)).rejects.toThrow('wrong_account')
  })
  it('treats invalid_grant and unauthorized tokens as reconnect required', async () => {
    const transport = vi.fn().mockResolvedValue(response({ error: 'invalid_grant' }, 400))
    await expect(googleTokens(config, { grant_type: 'refresh_token', refresh_token: 'inert' }, transport)).rejects.toThrow('reconnect_required')
  })
  it('rejects missing scope, expired token responses, and unexpected send grants', async () => {
    for (const data of [{ access_token: 'inert', expires_in: 0 }, { access_token: 'inert', expires_in: 3600, scope: gmailScope + ' https://www.googleapis.com/auth/gmail.send' }, { access_token: 'inert', expires_in: 3600, scope: '' }]) {
      await expect(googleTokens(config, { grant_type: 'authorization_code' }, vi.fn().mockResolvedValue(response(data)))).rejects.toThrow()
    }
  })
  it('does not mistake provider outages for revocation', async () => {
    await expect(googleTokens(config, {}, vi.fn().mockResolvedValue(response({}, 503)))).rejects.toThrow('provider_unavailable')
  })
  it('extracts UTF-8 MIME text while excluding attachments and preferring plain alternatives', () => {
    const encoded = (value: string) => Buffer.from(value).toString('base64url')
    expect(messageText({ parts: [{ mimeType: 'text/plain', body: { data: encoded('Résumé fixture') } }, { mimeType: 'text/html', body: { data: encoded('<p>duplicate</p>') } }, { mimeType: 'text/plain', filename: 'private.txt', body: { data: encoded('attachment') } }] })).toBe('Résumé fixture')
  })
})
