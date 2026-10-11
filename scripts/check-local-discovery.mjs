import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// Run with `supabase functions serve --env-file .env.phase3-test.local` in another
// terminal. That ignored file must use fixture Google credentials, never live ones.
const config = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
assert.equal(config.API_URL, 'http://127.0.0.1:54321', 'local Supabase only')
function sql(query) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_jobpilot', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}
assert.equal(sql('select count(*) from jobpilot_private.owner_registration').trim(), '0', 'refusing to change an existing local owner')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, options)
const users = []
const check = (result, label) => { assert.equal(result.error, null, `${label}: ${result.error?.message ?? ''}`); return result.data }
let owner
async function account() {
  const email = `fixture-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url')
  const user = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'create synthetic user').user
  users.push(user.id)
  const client = createClient(config.API_URL, config.PUBLISHABLE_KEY, options)
  const session = check(await client.auth.signInWithPassword({ email, password }), 'local sign in').session
  return { client, id: user.id, token: session.access_token }
}
async function api(token, body) {
  const response = await fetch(`${config.API_URL}/functions/v1/jobpilot-api`, { method: 'POST', headers: { apikey: config.PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4173' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) })
  return { status: response.status, data: await response.json() }
}
try {
  owner = await account()
  const other = await account()
  sql(`insert into jobpilot_private.owner_registration(user_id) values ('${owner.id}')`)
  assert.equal((await api('invalid', { action: 'manual' })).status, 401)
  assert.equal((await api(other.token, { action: 'manual' })).status, 403)
  const input = { action: 'manual', url: 'https://example.invalid/jobs/42?utm_source=fixture', description: 'Title: Fixture Engineer\nCompany: Fixture Company\nRequired skills: React' }
  assert.deepEqual(await api(owner.token, input), { status: 200, data: { added: true } })
  assert.deepEqual(await api(owner.token, input), { status: 200, data: { added: false } })
  const jobs = check(await owner.client.from('imported_jobs').select('*'), 'read own jobs')
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].canonical_url, 'https://example.invalid/jobs/42')
  check(await owner.client.from('job_reviews').update({ disposition: 'saved', reviewed: true }).eq('job_id', jobs[0].id).select('job_id').single(), 'review update with column grants')
  assert.equal(check(await other.client.from('imported_jobs').select('*'), 'non-owner RLS').length, 0)
  assert.ok((await owner.client.from('gmail_credentials').select('*')).error)
  const consent = await api(owner.token, { action: 'connect', email: 'fixture@example.invalid' })
  assert.equal(consent.status, 200)
  const auth = new URL(consent.data.url)
  assert.equal(auth.hostname, 'accounts.google.com')
  assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly')
  const callback = new URL(`${config.API_URL}/functions/v1/gmail-callback`)
  callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), error: 'access_denied' }).toString()
  // Consent denial consumes state without ever contacting Google.
  for (const expected of ['consent_denied', 'invalid_state']) {
    const response = await fetch(callback, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('location'), `http://127.0.0.1:4173/settings?gmail=${expected}`)
  }
  assert.equal((await api(owner.token, { action: 'disconnect' })).status, 200)
  assert.equal(check(await owner.client.from('gmail_connections').select('status').single(), 'connection status').status, 'disconnected')
  console.log('Local Edge/Auth/PostgREST PASS: runtime startup, owner authorization, manual import and canonical deduplication, review column privileges, RLS, OAuth consent denial and state reuse, fixed callback redirect, disconnect. Synthetic fixtures only; no Google requests or emails sent.')
} finally {
  if (owner) sql(`begin;
    delete from public.job_reviews where owner_id = '${owner.id}';
    delete from public.job_origins where owner_id = '${owner.id}';
    delete from public.imported_jobs where owner_id = '${owner.id}';
    delete from public.import_runs where owner_id = '${owner.id}';
    delete from public.job_sources where owner_id = '${owner.id}';
    delete from public.gmail_connections where owner_id = '${owner.id}';
    delete from jobpilot_private.owner_registration where user_id = '${owner.id}'; commit;`)
  for (const id of users) check(await admin.auth.admin.deleteUser(id), 'synthetic auth user cleanup')
}
