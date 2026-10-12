// Copied by prepare-local-edge.mjs into an ignored local-only function directory.
// Never deploy this fixture. Production entrypoints do not import it.
import { apiHandler, callbackHandler } from '../_shared/service.ts'
import { runtime } from '../_shared/runtime.ts'
const { db, config } = runtime()
if (!['kong','127.0.0.1','localhost'].includes(new URL(Deno.env.get('SUPABASE_URL')!).hostname) || config.google.clientId !== 'phase4-fixture-client') throw new Error('Local fixture only')
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data),{status})
const mockGoogle: typeof fetch = async (input,init) => {
  const url = String(input)
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(String(init?.body))
    if (form.get('refresh_token') === 'revoked-fixture') return json({error:'invalid_grant'},400)
    return json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'})
  }
  if (url.endsWith('/users/me/profile')) return json({emailAddress:'fixture@example.invalid'})
  if (url.endsWith('/users/me/messages/send')) {
    const raw = JSON.parse(String(init?.body)).raw
    const mime = atob(raw.replaceAll('-','+').replaceAll('_','/'))
    if (!/^To: [^\r\n]+@example\.invalid\r$/m.test(mime)) throw new Error('Only synthetic recipients allowed')
    if (mime.includes('To: timeout@example.invalid')) throw new DOMException('Synthetic timeout','TimeoutError')
    if (mime.includes('To: rejected@example.invalid')) return json({error:'fixture rejection'},403)
    if (!mime.includes('Content-Type: application/pdf')) throw new Error('Missing fixture attachment')
    return json({id:'fixture-gmail-message'})
  }
  throw new Error('Network route blocked by local fixture')
}
Deno.serve(request => request.method === 'GET' ? callbackHandler(db,config,mockGoogle)(request) : apiHandler(db,config,mockGoogle)(request))
