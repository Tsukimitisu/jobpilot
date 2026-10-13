import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const config = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js','status','-o','json'], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }))
assert.equal(config.API_URL,'http://127.0.0.1:54321','local Supabase only')
const sql = query => execFileSync('docker',['exec','-i','supabase_db_jobpilot','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'], { input:query, encoding:'utf8', stdio:['pipe','pipe','pipe'] })
assert.equal(sql('select count(*) from jobpilot_private.owner_registration').trim(),'0','refusing to touch an existing owner')
const secret = (await readFile('.env.phase4-test.local','utf8')).match(/^JOBPILOT_SCHEDULER_SECRET=(.+)$/m)?.[1]
assert.ok(secret)
const options = { auth:{persistSession:false,autoRefreshToken:false} }
const admin = createClient(config.API_URL,config.SERVICE_ROLE_KEY,options)
const check = result => { assert.equal(result.error,null,result.error?.message); return result.data }
let owner
const endpoint = `${config.API_URL}/functions/v1/phase5-fixture`
const request = async (token, body, scheduled = false, production = false) => {
  if (scheduled && token === secret) {
    const time = Math.floor(Date.now() / 1000)
    token = `${time}.${createHmac('sha256', secret).update(`jobpilot-discovery-v1:${time}`).digest('hex')}`
  }
  const response = await fetch(production ? `${config.API_URL}/functions/v1/discovery-scheduler` : endpoint, {
    method:'POST', headers:{apikey:config.PUBLISHABLE_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(scheduled ? {'x-fixture-route':'scheduler'} : {Origin:'http://127.0.0.1:4173'})},
    body:JSON.stringify(body),signal:AbortSignal.timeout(140000),
  })
  return { status:response.status, data:await response.json() }
}
const due = () => sql(`update public.discovery_automation set next_run_at = now() - interval '1 minute' where owner_id = '${owner.id}'`)
try {
  const email = `fixture-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url')
  owner = check(await admin.auth.admin.createUser({email,password,email_confirm:true})).user
  const client = createClient(config.API_URL,config.PUBLISHABLE_KEY,options)
  const token = check(await client.auth.signInWithPassword({email,password})).session.access_token
  sql(`insert into jobpilot_private.owner_registration(user_id) values ('${owner.id}')`)
  const api = async body => { const r = await request(token,body); assert.equal(r.status,200,JSON.stringify(r.data)); return r.data }
  // The actual production endpoint is exercised only with invalid auth or automation OFF.
  assert.equal((await request(token,{},true,true)).status,401)
  assert.equal((await request(config.SERVICE_ROLE_KEY,{},true,true)).status,401)
  assert.deepEqual((await request(secret,{},true,true)).data,{status:'skipped'})
  await api({action:'add_greenhouse',board:'fixture'})
  await api({action:'add_greenhouse',board:'fixture-disabled'})
  const sources = check(await admin.from('job_sources').select('*'))
  await api({action:'toggle_source',sourceId:sources.find(s=>s.source_key==='fixture-disabled').id,enabled:false})
  await api({action:'set_automation',enabled:true})
  assert.equal((await request(secret,{},true)).data.status,'skipped','future slot is not due')
  due()
  const concurrent = await Promise.all([request(secret,{owner_id:randomUUID(),action:'application_send'},true),request(secret,{},true)])
  assert.equal(concurrent.filter(r=>r.data.status==='succeeded').length,1)
  assert.equal(concurrent.filter(r=>r.data.status==='skipped').length,1)
  assert.equal(check(await admin.from('imported_jobs').select('id')).length,50)
  assert.equal(check(await admin.from('job_sources').select('cursor').eq('source_key','fixture').single()).cursor,'50')
  due(); await request(secret,{},true)
  assert.equal(check(await admin.from('imported_jobs').select('id')).length,55)
  due(); await request(secret,{},true)
  assert.equal(check(await admin.from('imported_jobs').select('id')).length,55,'repeated discovery deduplicates')
  await api({action:'set_automation',enabled:false}); due()
  assert.equal((await request(secret,{},true)).data.status,'skipped','paused schedule skips')
  await api({action:'set_automation',enabled:true})
  const connect = await api({action:'connect',email:'fixture@example.invalid'})
  const callback = await fetch(`${endpoint}?state=${new URL(connect.url).searchParams.get('state')}&code=fixture`,{redirect:'manual'})
  assert.ok(callback.headers.get('location').endsWith('gmail=connected'))
  await api({action:'save_gmail_label',labelId:'Label_fixture'})
  due(); await request(secret,{},true)
  assert.equal(check(await admin.from('imported_jobs').select('id')).length,56,'selected label imported; moved message excluded')
  const revoked = await api({action:'connect',email:'fixture@example.invalid'})
  await fetch(`${endpoint}?state=${new URL(revoked.url).searchParams.get('state')}&code=revoke-on-refresh`,{redirect:'manual'})
  due(); await request(secret,{},true)
  assert.equal(check(await admin.from('gmail_connections').select('status').single()).status,'reconnect_required')
  assert.equal(check(await admin.from('imported_jobs').select('id')).length,56,'expired grant preserves jobs')
  assert.equal(check(await admin.from('import_runs').select('id').eq('source_id',sources.find(s=>s.source_key==='fixture-disabled').id)).length,0)
  assert.equal(check(await admin.from('applications').select('id')).length,0,'scheduler never creates applications')
  console.log('Local scheduled Edge/Auth/PostgREST PASS: dedicated authentication, owner control, overlap, disabled source, cursor continuation, deduplication, label membership, expired grant, jobs preserved, zero applications. Providers mocked; zero real email.')
} finally {
  if (owner) {
    sql(`begin;
      delete from public.job_reviews where owner_id='${owner.id}';
      delete from public.job_origins where owner_id='${owner.id}';
      delete from public.imported_jobs where owner_id='${owner.id}';
      delete from public.import_runs where owner_id='${owner.id}';
      delete from public.automation_runs where owner_id='${owner.id}';
      delete from public.discovery_automation where owner_id='${owner.id}';
      delete from public.job_sources where owner_id='${owner.id}';
      delete from public.gmail_connections where owner_id='${owner.id}';
      delete from jobpilot_private.owner_registration where user_id='${owner.id}'; commit;`)
    check(await admin.auth.admin.deleteUser(owner.id))
  }
}
