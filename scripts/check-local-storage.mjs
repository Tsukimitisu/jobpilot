import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const config = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
assert.equal(config.API_URL, 'http://127.0.0.1:54321', 'only the default local Supabase instance is permitted')
function sql(query) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_jobpilot', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}
assert.equal(sql('select count(*) from jobpilot_private.owner_registration;').trim(), '0', 'refusing to modify a configured owner; use a fresh local database')
const owner = randomUUID(), other = randomUUID()
function jwt(id) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })}`
  return `${payload}.${createHmac('sha256', config.JWT_SECRET).update(payload).digest('base64url')}`
}
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) } }
const ownerClient = createClient(config.API_URL, config.PUBLISHABLE_KEY, { ...options, accessToken: async () => jwt(owner) })
const otherClient = createClient(config.API_URL, config.PUBLISHABLE_KEY, { ...options, accessToken: async () => jwt(other) })
const anonClient = createClient(config.API_URL, config.PUBLISHABLE_KEY, options)
const records = []
const bootstrap = await readFile(new URL('../supabase/bootstrap-owner.sql', import.meta.url), 'utf8')
const check = (result, label) => assert.equal(result.error, null, `${label}: ${result.error?.message ?? ''}`)
const body = new Blob(['%PDF-1.4\nLocal inert authorization test only.\n%%EOF'], { type: 'application/pdf' })
try {
  sql(`begin; insert into auth.users(id) values ('${owner}'), ('${other}'); commit;`)
  assert.throws(() => sql(bootstrap.replace('REPLACE_WITH_EXISTING_AUTH_USER_UUID', randomUUID())), /existing Supabase Auth user/)
  sql(bootstrap.replace('REPLACE_WITH_EXISTING_AUTH_USER_UUID', owner))
  sql(bootstrap.replace('REPLACE_WITH_EXISTING_AUTH_USER_UUID', owner))
  assert.throws(() => sql(bootstrap.replace('REPLACE_WITH_EXISTING_AUTH_USER_UUID', other)), /different JobPilot owner/)
  check(await ownerClient.from('owner_profiles').upsert({ owner_id: owner, full_name: 'Local Test Owner', contact_email: 'local@example.invalid', skills: ['Testing'], work_modes: null }), 'profile save')
  const profile = await ownerClient.from('owner_profiles').select('*').single()
  check(profile, 'profile reload'); assert.equal(profile.data.full_name, 'Local Test Owner'); assert.equal(profile.data.work_modes, null)
  check(await ownerClient.from('owner_profiles').update({ location: 'Test City' }).eq('owner_id', owner), 'profile update')
  assert.equal((await otherClient.from('owner_profiles').select('*')).data.length, 0, 'non-owner profile read denied')
  assert.ok((await anonClient.from('owner_profiles').select('*')).error, 'anonymous profile read denied')
  assert.ok((await otherClient.from('owner_profiles').insert({ owner_id: other, full_name: 'Other', contact_email: 'other@example.invalid' })).error, 'non-owner profile write denied')
  async function record(size = body.size) {
    const id = randomUUID(), path = `${owner}/${id}.pdf`
    check(await ownerClient.from('resumes').insert({ id, owner_id: owner, object_path: path, original_name: 'local-test.pdf', byte_size: size }), 'insert metadata')
    const value = { id, path }; records.push(value); return value
  }
  const first = await record(), second = await record()
  check(await ownerClient.storage.from('resumes').upload(first.path, body), 'owner PDF upload')
  check(await ownerClient.storage.from('resumes').upload(second.path, body), 'second owner PDF upload')
  check(await ownerClient.rpc('complete_resume', { upload_id: first.id }), 'completion')
  check(await ownerClient.rpc('complete_resume', { upload_id: second.id }), 'second completion')
  check(await ownerClient.storage.from('resumes').download(first.path), 'authenticated owner download')
  assert.ok((await anonClient.storage.from('resumes').download(first.path)).error, 'anonymous download must fail')
  assert.ok((await otherClient.storage.from('resumes').download(first.path)).error, 'non-owner download must fail')
  for (const client of [anonClient, otherClient]) {
    const listed = await client.storage.from('resumes').list(owner)
    assert.ok(listed.error || listed.data.length === 0, 'unauthorized list must be empty or denied')
    await client.storage.from('resumes').remove([first.path])
    check(await ownerClient.storage.from('resumes').download(first.path), 'unauthorized deletion must leave owner object intact')
  }
  assert.ok((await otherClient.storage.from('resumes').upload(`${other}/${randomUUID()}.pdf`, body)).error, 'non-owner upload denied')
  assert.ok((await ownerClient.storage.from('resumes').update(first.path, body)).error, 'overwriting a resume is forbidden')
  const wrongType = await record()
  assert.ok((await ownerClient.storage.from('resumes').upload(wrongType.path, new Blob(['not a PDF'], { type: 'text/plain' }))).error, 'bucket rejects wrong MIME')
  const tooLarge = await record(10485760)
  assert.ok((await ownerClient.storage.from('resumes').upload(tooLarge.path, new Blob([new Uint8Array(10485761)], { type: 'application/pdf' }))).error, 'bucket rejects more than 10 MiB')
  const concurrent = await Promise.all([first, second].map(value => ownerClient.rpc('set_default_resume', { selected_id: value.id })))
  concurrent.forEach(result => check(result, 'concurrent default selection'))
  const selected = await ownerClient.from('resume_defaults').select('*')
  check(selected, 'read default'); assert.equal(selected.data.length, 1)
  const selectedRecord = records.find(value => value.id === selected.data[0].resume_id)
  check(await ownerClient.storage.from('resumes').remove([selectedRecord.path]), 'owner deletes private object')
  check(await ownerClient.from('resumes').delete().eq('id', selectedRecord.id), 'owner deletes metadata')
  assert.equal((await ownerClient.from('resume_defaults').select('*')).data.length, 0, 'deleting selected resume clears default')
  console.log('Local Storage API PASS: bootstrap validation/idempotency/conflict, owner upload/download/delete, anonymous and non-owner denial, MIME/size rejection, no overwrite, concurrent defaults and cascade cleanup. No emails sent.')
} finally {
  for (const record of records) {
    check(await ownerClient.storage.from('resumes').remove([record.path]), 'fixture file cleanup')
    check(await ownerClient.from('resumes').delete().eq('id', record.id), 'fixture metadata cleanup')
  }
  sql(`begin; delete from public.owner_profiles where owner_id = '${owner}'; delete from jobpilot_private.owner_registration where user_id = '${owner}'; delete from auth.users where id = '${owner}'; delete from auth.users where id = '${other}'; commit;`)
  console.log('Only synthetic fixtures from this run were removed; local ownership is unconfigured again.')
}
