// Copied into an ignored function directory by prepare-local-edge.mjs. Never deploy.
import { apiHandler, callbackHandler } from '../_shared/service.ts'
import { schedulerHandler } from '../_shared/scheduler.ts'
import { runtime } from '../_shared/runtime.ts'
const { db, config } = runtime()
if (!['kong','127.0.0.1','localhost'].includes(new URL(Deno.env.get('SUPABASE_URL')!).hostname) || config.google.clientId !== 'phase4-fixture-client') throw new Error('Local fixture only')
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const provider: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(String(init?.body))
    if (form.get('refresh_token') === 'revoked-fixture') return json({ error: 'invalid_grant' }, 400)
    return json({ access_token: 'fixture', refresh_token: form.get('code') === 'revoke-on-refresh' ? 'revoked-fixture' : 'fixture', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' })
  }
  if (url.href === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return json({ emailAddress: 'fixture@example.invalid' })
  if (url.href === 'https://gmail.googleapis.com/gmail/v1/users/me/labels') return json({ labels: [{ id: 'Label_fixture', name: 'JobPilot/Alerts', type: 'user' }] })
  if (url.pathname === '/gmail/v1/users/me/messages' && url.hostname === 'gmail.googleapis.com') {
    if (url.searchParams.get('labelIds') !== 'Label_fixture' || url.searchParams.get('maxResults') !== '10') throw new Error('Label boundary violated')
    return json({ messages: [{ id: 'fixture' }, { id: 'moved' }] })
  }
  if (url.href === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/fixture?format=full') return json({ labelIds: ['Label_fixture'], payload: { mimeType: 'text/plain', body: { data: btoa('Title: Fixture email job\nhttps://example.invalid/email-job') } } })
  if (url.href === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/moved?format=full') return json({ labelIds: ['INBOX'] })
  if (url.hostname === 'boards-api.greenhouse.io' && url.pathname.startsWith('/v1/boards/fixture')) {
    if (url.pathname.includes('fixture-failed')) return json({}, 429)
    if (url.pathname.endsWith('/jobs')) return json({ jobs: Array.from({ length: 55 }, (_, i) => ({ id: i + 1, title: `Fixture job ${i + 1}`, content: 'Synthetic job', absolute_url: `https://example.invalid/board/${i + 1}` })) })
    return json({ name: 'Fixture board' })
  }
  throw new Error('Network blocked: no emails or unexpected provider routes allowed')
}
Deno.serve(request => request.headers.get('x-fixture-route') === 'scheduler'
  ? schedulerHandler(db, config, Deno.env.get('JOBPILOT_SCHEDULER_SECRET') ?? '', provider)(request)
  : request.method === 'GET' ? callbackHandler(db, config, provider)(request) : apiHandler(db, config, provider)(request))
