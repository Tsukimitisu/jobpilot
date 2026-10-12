import { webcrypto, createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applicationAction, buildMime, sendApplication } from '../supabase/functions/_shared/applications'
import { validRecipient, type Application } from '../supabase/functions/_shared/application-data'
import { apiHandler, gmailAccess } from '../supabase/functions/_shared/service'
import { encryptToken, gmailScope, gmailSendScope, randomSecret, ServiceError } from '../supabase/functions/_shared/google'

const owner = '30000000-0000-0000-0000-000000000001', id = '40000000-0000-0000-0000-000000000001', resumeId = '50000000-0000-0000-0000-000000000001'
const bytes = new TextEncoder().encode('%PDF-1.4\nSynthetic fixture only\n%%EOF')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),{ status })
async function backend() {
  const config = { appOrigin: 'https://app.example.invalid', google: { clientId: 'fixture', clientSecret: 'inert', encryptionKey: randomSecret(), redirectUri: 'https://example.invalid/callback' } }
  const row = { id,owner_id:owner,job_id:id,resume_id:resumeId,recipient:'employer@example.invalid',recipient_verified:true,subject:'Application: Développeur',body:'Hello,\nRésumé fixture only.',status:'ready',revision:3,sender_email:'owner@example.invalid',gmail_generation:'g',resume_name:'private résumé.pdf',resume_bytes:bytes.length,resume_sha256:createHash('sha256').update(bytes).digest('hex'),attempt_id:null,gmail_message_id:null } as Application
  const connection = { owner_id:owner,status:'connected',generation:'g',expected_email:row.sender_email,granted_scopes:[gmailScope,gmailSendScope],send_consented_at:'2026-01-01' }
  const credential = { encrypted_refresh_token:await encryptToken('inert-refresh',owner,config.google.encryptionKey),generation:'g' }
  const resume = { id:resumeId,owner_id:owner,object_path:`${owner}/${resumeId}.pdf`,mime_type:'application/pdf',byte_size:bytes.length,status:'ready' }
  const state = { missingResume:false, storageError:false, failCommit:false, owner:true }
  const rpc = vi.fn(async (name: string, args: Record<string,unknown>) => {
    if (name === 'phase3_is_owner') return { data:state.owner,error:null }
    if (name !== 'application_command') throw new Error('Unexpected RPC')
    if (args.p_owner !== owner || args.p_id !== id) return { data:null,error:{ message:'application_not_found' } }
    if (args.p_revision !== row.revision) return { data:null,error:{ message:'application_changed' } }
    if (args.p_action === 'reserve') {
      if (row.status !== 'ready' || row.attempt_id) return { data:null,error:{ message:'application_locked' } }
      if (!connection.send_consented_at || !connection.granted_scopes.includes(gmailSendScope)) return { data:null,error:{ message:'send_consent_required' } }
      row.status='sending'; row.attempt_id=crypto.randomUUID(); row.revision++
    } else if (args.p_action === 'finish') {
      if (state.failCommit) return { data:null,error:{ message:'database unavailable' } }
      Object.assign(row,args.p_data); row.revision++
    }
    return { data:{ ...row },error:null }
  })
  const from = (table: string) => {
    const filters: [string,unknown][] = []; let patch: Record<string,unknown> | undefined
    const value = () => table === 'applications' ? row : table === 'gmail_connections' ? connection : table === 'gmail_credentials' ? credential : table === 'resumes' ? (state.missingResume ? null : resume) : table === 'owner_profiles' ? { full_name:'Fixture Owner' } : { title:'Fixture Engineer' }
    const result = () => {
      const data = value()
      if (filters.some(([key,v]) => data && key in data && data[key as keyof typeof data] !== v)) return { data:null,error:{ message:'not found' } }
      if (patch && data) Object.assign(data,patch)
      return { data,error:null }
    }
    const query = { select:()=>query,eq:(key:string,v:unknown)=>{ filters.push([key,v]); return query },single:async()=>result(),maybeSingle:async()=>result(),update:(p:Record<string,unknown>)=>{ patch=p;return query },then:(resolve:(r:unknown)=>unknown)=>Promise.resolve(result()).then(resolve) }
    return query
  }
  const download = vi.fn(async () => ({ data:state.storageError ? null : new Blob([bytes]),error:state.storageError ? new Error('private diagnostic') : null }))
  const db = { from,rpc,storage:{ from:()=>({ download }) },auth:{ getUser:async()=>({ data:{ user:{ id:owner } },error:null }) } } as unknown as SupabaseClient
  return { db,row,state,connection,config,rpc,download }
}
beforeEach(()=>{ vi.stubGlobal('crypto',webcrypto); vi.stubGlobal('fetch',vi.fn(()=>{ throw new Error('Live network prohibited') })) })
afterEach(()=>vi.unstubAllGlobals())

describe('application backend; synthetic addresses and injected Gmail only',()=>{
  it.each(['','alerts@example.invalid,other@example.invalid','Name <a@example.invalid>','a@example.invalid\r\nBcc: x@example.invalid','.a@example.invalid','a..b@example.invalid','a@-example.invalid'])('rejects recipient %j',recipient=>expect(validRecipient(recipient)).toBe(false))
  it('encodes UTF-8 subject/body, CRLF MIME, and the exact PDF without adding recipients',async()=>{
    const api=await backend(); api.row.attempt_id=crypto.randomUUID()
    const raw=buildMime(api.row,bytes), mime=Buffer.from(raw,'base64url').toString()
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(mime).toContain('To: employer@example.invalid\r\n')
    expect(mime).not.toContain('Bcc:'); expect(mime).not.toContain('Cc:')
    expect(mime).toContain(Buffer.from(bytes).toString('base64'))
    expect(mime).toContain(Buffer.from(api.row.body).toString('base64'))
    expect(mime).toContain(`filename="resume-${resumeId}.pdf"`)
    expect(mime.split('\r\n').every(line=>line.length<=998)).toBe(true)
    const subject=mime.match(/Subject: =\?UTF-8\?B\?([^?]+)/)![1]
    expect(Buffer.from(subject,'base64').toString()).toBe(api.row.subject)
  })
  it('persists Gmail ID and only one initial send wins concurrent duplicate taps',async()=>{
    const api=await backend(), transport=vi.fn().mockResolvedValue(json({ id:'gmail-fixture-id' }))
    const results=await Promise.allSettled([sendApplication(api.db,owner,id,3,async()=> 'inert',transport),sendApplication(api.db,owner,id,3,async()=> 'inert',transport)])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(transport).toHaveBeenCalledTimes(1); expect(api.row.gmail_message_id).toBe('gmail-fixture-id'); expect(api.row.status).toBe('sent')
    await expect(sendApplication(api.db,owner,id,api.row.revision,async()=> 'inert',transport)).rejects.toThrow('application_locked')
  })
  it.each([400,401,403,413,429])('records definite Gmail rejection %s as failed without retry',async status=>{
    const api=await backend(), transport=vi.fn().mockResolvedValue(json({ error:'inert' },status))
    expect((await sendApplication(api.db,owner,id,3,async()=> 'inert',transport)).status).toBe('failed'); expect(transport).toHaveBeenCalledTimes(1)
  })
  it.each(['timeout','503','malformed'])('keeps %s delivery ambiguous and never retries',async kind=>{
    const api=await backend(), transport=kind==='timeout' ? vi.fn().mockRejectedValue(new DOMException('Timed out','TimeoutError')) : vi.fn().mockResolvedValue(kind==='503' ? json({},503) : json({}))
    expect((await sendApplication(api.db,owner,id,3,async()=> 'inert',transport)).status).toBe('delivery_unknown')
    await expect(sendApplication(api.db,owner,id,api.row.revision,async()=> 'inert',transport)).rejects.toThrow('application_locked')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('does not resend after Gmail accepted but database acknowledgement was lost',async()=>{
    const api=await backend();api.state.failCommit=true
    const transport=vi.fn().mockResolvedValue(json({ id:'accepted-fixture' }))
    await expect(sendApplication(api.db,owner,id,3,async()=> 'inert',transport)).rejects.toThrow('database_error')
    expect(api.row.status).toBe('sending')
    await expect(sendApplication(api.db,owner,id,api.row.revision,async()=> 'inert',transport)).rejects.toThrow('application_locked')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it.each(['missing','inaccessible','changed'])('does not send a %s resume',async kind=>{
    const api=await backend();api.state.missingResume=kind==='missing';api.state.storageError=kind==='inaccessible';if(kind==='changed') api.row.resume_sha256='different'
    const transport=vi.fn();expect((await sendApplication(api.db,owner,id,3,async()=> 'inert',transport)).status).toBe('failed');expect(transport).not.toHaveBeenCalled()
  })
  it('requires fresh stored consent even if the old token might have send permission',async()=>{
    const api=await backend();api.connection.send_consented_at=''
    const transport=vi.fn();await expect(sendApplication(api.db,owner,id,3,async()=> 'inert',transport)).rejects.toThrow('send_consent_required');expect(transport).not.toHaveBeenCalled()
  })
  it.each(['revoked','missing_scope'])('checks %s with Google before sending',async kind=>{
    const api=await backend(), transport=vi.fn().mockResolvedValue(kind==='revoked' ? json({ error:'invalid_grant' },400) : json({ access_token:'inert',expires_in:3600,scope:gmailScope }))
    const result=await sendApplication(api.db,owner,id,3,()=>gmailAccess(api.db,owner,api.config.google,transport,true),transport)
    expect(result.status).toBe('failed');expect(api.connection.status).toBe('reconnect_required');expect(transport).toHaveBeenCalledTimes(1)
    expect(String(transport.mock.calls[0][0])).not.toContain('/messages/send')
  })
  it('refuses an unconfirmed send before reserving it',async()=>{
    const api=await backend();await expect(applicationAction(api.db,owner,{ action:'application_send',id,revision:3 },async()=> 'inert',vi.fn())).rejects.toThrow('confirmation_required');expect(api.rpc).not.toHaveBeenCalled()
  })
  it('requires auth and owner access at the actual handler for sending',async()=>{
    const api=await backend(), transport=vi.fn(), handle=apiHandler(api.db,api.config,transport)
    expect((await handle(new Request(api.config.appOrigin,{ method:'POST',body:JSON.stringify({ action:'application_send' }) }))).status).toBe(401)
    api.state.owner=false
    expect((await handle(new Request(api.config.appOrigin,{ method:'POST',headers:{ Authorization:'Bearer inert' },body:JSON.stringify({ action:'application_send' }) }))).status).toBe(403)
    expect(transport).not.toHaveBeenCalled()
  })
  it('preflight failures release only definite unsent attempts',async()=>{
    const api=await backend(),transport=vi.fn()
    const result=await sendApplication(api.db,owner,id,3,async()=>{throw new ServiceError('reconnect_required')},transport)
    expect(result.status).toBe('failed');expect(result.error_code).toBe('reconnect_required');expect(transport).not.toHaveBeenCalled()
  })
})
