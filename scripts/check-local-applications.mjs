import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
const config=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
assert.equal(config.API_URL,'http://127.0.0.1:54321','local Supabase only')
const sql=query=>execFileSync('docker',['exec','-i','supabase_db_jobpilot','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
assert.equal(sql('select count(*) from jobpilot_private.owner_registration'),'0','refusing to change existing local owner')
const options={auth:{persistSession:false,autoRefreshToken:false}}, admin=createClient(config.API_URL,config.SERVICE_ROLE_KEY,options),users=[]
const check=(r,label)=>{assert.equal(r.error,null,`${label}: ${r.error?.message??''}`);return r.data}
let owner, resume
async function account(){const email=`fixture-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');const user=check(await admin.auth.admin.createUser({email,password,email_confirm:true}),'create synthetic user').user;users.push(user.id);const client=createClient(config.API_URL,config.PUBLISHABLE_KEY,options);const session=check(await client.auth.signInWithPassword({email,password}),'sign in').session;return {client,id:user.id,token:session.access_token}}
async function api(token,body,endpoint='phase4-fixture'){const r=await fetch(`${config.API_URL}/functions/v1/${endpoint}`,{method:'POST',headers:{apikey:config.PUBLISHABLE_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:'http://127.0.0.1:4173'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});return {status:r.status,data:await r.json()}}
async function success(body){const r=await api(owner.token,body);assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
async function action(a,name,data={}){return success({action:`application_${name}`,id:a.id,revision:a.revision,...data})}
async function draft(recipient){await success({action:'manual',url:`https://example.invalid/jobs/${randomUUID()}`,title:'Synthetic Engineer',description:'Fixture job'});const jobs=check(await owner.client.from('imported_jobs').select('*').order('created_at',{ascending:false}),'jobs');const j=jobs[0];check(await owner.client.from('job_reviews').update({disposition:'saved',reviewed:true}).eq('job_id',j.id),'review');let a=await success({action:'application_create',jobId:j.id});assert.equal(a.recipient,'');a=await action(a,'save',{recipient,recipient_verified:true,subject:'Synthetic application',body:'This is an inert local fixture.',resume_id:resume.id});return action(a,'ready')}
try {
  owner=await account();const other=await account();sql(`insert into jobpilot_private.owner_registration(user_id) values('${owner.id}')`)
  assert.equal((await api('invalid',{action:'application_send'})).status,401)
  assert.equal((await api(other.token,{action:'application_send'})).status,403)
  const pdf=Buffer.from('%PDF-1.4\nSynthetic fixture only\n%%EOF'),rid=randomUUID();resume={id:rid,owner_id:owner.id,object_path:`${owner.id}/${rid}.pdf`,original_name:'fixture.pdf',byte_size:pdf.length}
  check(await owner.client.from('resumes').insert(resume),'resume metadata');check(await owner.client.storage.from('resumes').upload(resume.object_path,pdf,{contentType:'application/pdf',upsert:false}),'private PDF upload');check(await owner.client.rpc('complete_resume',{upload_id:rid}),'complete PDF')
  let a=await draft('accepted@example.invalid')
  assert.equal((await api(owner.token,{action:'application_send',id:a.id,revision:a.revision,confirmed:true})).data.error,'send_consent_required')
  const connect=await success({action:'connect_send',email:'fixture@example.invalid'}), consent=new URL(connect.url)
  assert.equal(consent.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send')
  const callback=new URL(`${config.API_URL}/functions/v1/phase4-fixture`);callback.search=new URLSearchParams({state:consent.searchParams.get('state'),code:'fixture-code'}).toString()
  const completed=await fetch(callback,{redirect:'manual'});assert.equal(completed.headers.get('location'),'http://127.0.0.1:4173/settings?gmail=connected')
  assert.equal((await fetch(callback,{redirect:'manual'})).headers.get('location'),'http://127.0.0.1:4173/settings?gmail=invalid_state')
  // The production entrypoint must reject an unconfirmed send before Google.
  assert.equal((await api(owner.token,{action:'application_send',id:a.id,revision:a.revision},'jobpilot-api')).data.error,'confirmation_required')
  a=await action(a,'save',{recipient:a.recipient,recipient_verified:true,subject:a.subject,body:a.body,resume_id:rid});a=await action(a,'ready')
  const pair=await Promise.all([api(owner.token,{action:'application_send',id:a.id,revision:a.revision,confirmed:true}),api(owner.token,{action:'application_send',id:a.id,revision:a.revision,confirmed:true})])
  assert.equal(pair.filter(r=>r.status===200).length,1,'real database reservation allows exactly one send');const sent=pair.find(r=>r.status===200).data;assert.equal(sent.status,'sent');assert.equal(sent.gmail_message_id,'fixture-gmail-message')
  assert.equal(check(await other.client.from('applications').select('*'),'other applications').length,0)
  assert.ok((await owner.client.from('applications').update({status:'sent'}).eq('id',sent.id)).error)
  await owner.client.storage.from('resumes').remove([resume.object_path]);assert.ok(check(await owner.client.storage.from('resumes').download(resume.object_path),'pinned attachment still present').size>0)
  const unknown=await action(await draft('timeout@example.invalid'),'send',{confirmed:true});assert.equal(unknown.status,'delivery_unknown')
  assert.equal((await api(owner.token,{action:'application_send',id:unknown.id,revision:unknown.revision,confirmed:true})).data.error,'application_locked')
  assert.equal((await action(unknown,'reconcile',{outcome:'not_found',note:'Checked synthetic Sent; unresolved'})).status,'delivery_unknown')
  const failed=await action(await draft('rejected@example.invalid'),'send',{confirmed:true});assert.equal(failed.status,'failed');assert.equal(failed.error_code,'send_permission_denied')
  const external=await action(await draft('external@example.invalid'),'external',{sent_at:'2026-01-01T00:00:00Z',note:'Manually applied through employer website'});assert.equal(external.status,'external');assert.equal(external.gmail_message_id,null)
  const before=sql(`select encrypted_refresh_token from public.gmail_credentials where owner_id='${owner.id}'`)
  const upgrade=await success({action:'connect_send',email:'fixture@example.invalid'});callback.search=new URLSearchParams({state:new URL(upgrade.url).searchParams.get('state'),error:'access_denied'}).toString();await fetch(callback,{redirect:'manual'})
  assert.equal(sql(`select encrypted_refresh_token from public.gmail_credentials where owner_id='${owner.id}'`),before,'cancelled reconnection preserves active token')
  const missing=await draft('missing@example.invalid');check(await admin.storage.from('resumes').remove([resume.object_path]),'simulate missing PDF');assert.equal((await action(missing,'send',{confirmed:true})).error_code,'resume_unavailable')
  console.log('Local Edge/Auth/PostgREST/Storage PASS: owner isolation, private PDF, explicit confirmation, fresh OAuth dual scope consent/replay/cancellation, real concurrent reservation, mocked Gmail acceptance/ID, rejection and timeout, no unknown retry, external tracking, missing PDF, pinned Storage deletion. No Google network requests or real emails.')
} finally {
  if(owner){sql(`delete from public.applications where owner_id='${owner.id}'`);if(resume){check(await admin.storage.from('resumes').remove([resume.object_path]),'Storage API fixture cleanup');sql(`delete from public.resumes where owner_id='${owner.id}'`)}sql(`begin; delete from public.job_reviews where owner_id='${owner.id}';delete from public.job_origins where owner_id='${owner.id}';delete from public.imported_jobs where owner_id='${owner.id}';delete from public.import_runs where owner_id='${owner.id}';delete from public.job_sources where owner_id='${owner.id}';delete from public.gmail_connections where owner_id='${owner.id}';delete from jobpilot_private.owner_registration where user_id='${owner.id}';commit;`)}
  for(const id of users) check(await admin.auth.admin.deleteUser(id),'auth fixture cleanup')
}
