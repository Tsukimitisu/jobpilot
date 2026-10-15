import { createClient } from '@supabase/supabase-js'
import type { BackendConfig } from './service.ts'

const required = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error('Backend configuration missing')
  return value
}
export function runtime() {
  const supabaseUrl = required('SUPABASE_URL')
  const origin = new URL(required('JOBPILOT_APP_ORIGIN'))
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Invalid application origin')
  const db = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000) }) } })
  const config: BackendConfig = { appOrigin: origin.origin, adzuna: { appId: Deno.env.get('ADZUNA_APP_ID') ?? '', appKey: Deno.env.get('ADZUNA_APP_KEY') ?? '' }, google: {
    clientId: Deno.env.get('GOOGLE_CLIENT_ID') ?? '', clientSecret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
    encryptionKey: Deno.env.get('GMAIL_TOKEN_ENCRYPTION_KEY') ?? '', redirectUri: `${supabaseUrl}/functions/v1/gmail-callback`,
  } }
  return { db, config }
}
