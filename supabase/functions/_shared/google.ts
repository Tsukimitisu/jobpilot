export const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly'
export class ServiceError extends Error {
  code: string
  constructor(code: string) { super(code); this.code = code }
}
export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string; encryptionKey: string }
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
export const randomSecret = () => encode(crypto.getRandomValues(new Uint8Array(32)))
export async function hash(value: string) { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))) }
async function key(value: string) {
  let bytes: Uint8Array<ArrayBuffer>
  try { bytes = decode(value) } catch { throw new ServiceError('backend_configuration') }
  if (bytes.length !== 32) throw new ServiceError('backend_configuration')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function encryptToken(token: string, owner: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) }, await key(secret), new TextEncoder().encode(token))
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`
}
export async function decryptToken(value: string, owner: string, secret: string) {
  const [version, iv, ciphertext] = value.split('.')
  if (version !== 'v1' || !iv || !ciphertext) throw new ServiceError('backend_configuration')
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: new TextEncoder().encode(owner) }, await key(secret), decode(ciphertext)))
  } catch { throw new ServiceError('backend_configuration') }
}
export function authorizationUrl(config: GoogleConfig, state: string, challenge: string, email: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: gmailScope, access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false',
    state, code_challenge: challenge, code_challenge_method: 'S256', login_hint: email }).toString()
  return url.href
}
export async function fetchJson(url: string, init: RequestInit = {}, transport: typeof fetch = fetch): Promise<Record<string, unknown>> {
  let response: Response
  try { response = await transport(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) }) }
  catch { throw new ServiceError('provider_unavailable') }
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > 8_000_000) throw new ServiceError('response_too_large')
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []; let size = 0
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 8_000_000) { await reader.cancel(); throw new ServiceError('response_too_large') }
      chunks.push(value)
    }
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  let data: Record<string, unknown>
  try { data = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new ServiceError('provider_unavailable') }
  if (!response.ok) {
    if (data.error === 'invalid_grant' || response.status === 401) throw new ServiceError('reconnect_required')
    if (response.status === 403) throw new ServiceError('permission_denied')
    if (response.status === 404) throw new ServiceError('source_not_found')
    if (response.status === 429) throw new ServiceError('rate_limited')
    throw new ServiceError('provider_unavailable')
  }
  return data
}
export async function googleTokens(config: GoogleConfig, grant: Record<string, string>, transport: typeof fetch = fetch) {
  const data = await fetchJson('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...grant, client_id: config.clientId, client_secret: config.clientSecret }) }, transport)
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.expires_in !== 'number' || data.expires_in <= 0) throw new ServiceError('token_failure')
  const scopes = typeof data.scope === 'string' ? data.scope.split(' ') : []
  if ((grant.grant_type === 'authorization_code' || typeof data.scope === 'string') && (!scopes.includes(gmailScope) || scopes.some(scope => scope.includes('/auth/gmail.') && scope !== gmailScope) || scopes.includes('https://mail.google.com/'))) throw new ServiceError('scope_mismatch')
  return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null }
}
export async function gmailGet(path: string, accessToken: string, transport: typeof fetch = fetch) {
  return fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } }, transport)
}
export async function verifyGmailIdentity(token: string, expected: string, transport: typeof fetch = fetch) {
  const profile = await gmailGet('profile', token, transport)
  if (typeof profile.emailAddress !== 'string' || profile.emailAddress.toLowerCase() !== expected.toLowerCase()) throw new ServiceError('wrong_account')
  return profile.emailAddress.toLowerCase()
}
export type GmailPart = { mimeType?: string; filename?: string; body?: { data?: string; size?: number }; parts?: GmailPart[]; headers?: { name: string; value: string }[] }
export function messageText(payload: GmailPart): string {
  const plain: string[] = [], html: string[] = []
  let count = 0
  function visit(part: GmailPart, depth: number) {
    if (++count > 100 || depth > 10 || part.filename) return
    if (part.body?.data && part.body.data.length < 400000 && ['text/plain', 'text/html'].includes(part.mimeType ?? '')) {
      try { (part.mimeType === 'text/plain' ? plain : html).push(new TextDecoder().decode(decode(part.body.data))) } catch { throw new ServiceError('invalid_message') }
    }
    for (const child of part.parts ?? []) visit(child, depth + 1)
  }
  visit(payload, 0)
  return (plain.length ? plain : html).join('\n').slice(0, 300000)
}
