import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApplicationsPage } from '../src/workspace/ApplicationsPage'
import { WorkspaceProvider } from '../src/workspace/WorkspaceContext'
import { DiscoveryProvider } from '../src/workspace/DiscoveryProvider'
import { type Application } from '../src/lib/applications'
const rid='50000000-0000-0000-0000-000000000001'
function backend(status: Application['status']='draft') {
  const a = { id:'application',owner_id:'owner',job_id:'job',status,revision:1,recipient:'',recipient_verified:false,subject:'Application: Fixture Engineer',body:'Hello,\nPlease review my attached resume.',resume_id:null,sender_email:'owner@example.invalid',resume_name:'Fixture resume.pdf',resume_bytes:100,resume_sha256:'fixture',created_at:'2026-01-01',updated_at:'2026-01-01',error_code:null,attempt_id:'fixture-attempt',sending_at:'2026-01-01' } as Application
  const state = { owner:true, send:true, failure:false, pending:false, application:a }
  const tables: Record<string,unknown[]> = { resumes:[{ id:rid,original_name:'Fixture resume.pdf',byte_size:100,status:'ready' }],imported_jobs:[{id:'job',title:'Fixture Engineer',company:'Fixture'}],job_origins:[{sender:'alerts@example.invalid',job_id:'job'}] }
  const from=vi.fn((table:string)=>{
    const data=()=>table==='applications' ? [{...state.application}] : table==='gmail_connections' ? [{status:'connected',connected_email:'owner@example.invalid',send_consented_at:state.send?'2026-01-01':null,granted_scopes:state.send?['https://www.googleapis.com/auth/gmail.send']:[]}] : tables[table]??[]
    const query={select:()=>query,order:()=>query,range:()=>query,limit:()=>query,maybeSingle:async()=>({data:data()[0]??null,error:null}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:data(),error:null}).then(resolve)}
    return query
  })
  const invoke=vi.fn(async (_name:string,{body}:{body:Record<string,unknown>})=>{
    if(state.pending) await new Promise(()=>{})
    if(state.failure) throw new Error('private diagnostic')
    const next={...state.application,revision:state.application.revision+(body.action==='application_refresh'?0:1)}
    if(body.action==='application_save') Object.assign(next,body,{status:'draft'})
    if(body.action==='application_ready') next.status='ready'
    if(body.action==='application_send') {next.status='sent';next.gmail_message_id='fixture-message'}
    if(body.action==='application_external') {next.status='external';next.external_sent_at=body.sent_at as string}
    state.application=next
    return {data:next,error:null}
  })
  const client={from,rpc:async()=>({data:state.owner,error:null}),functions:{invoke}} as unknown as SupabaseClient
  return {state,client,invoke,from}
}
function open(api:ReturnType<typeof backend>) {return render(<WorkspaceProvider client={api.client} ownerId="owner"><DiscoveryProvider><MemoryRouter initialEntries={['/applications?application=application']}><ApplicationsPage /></MemoryRouter></DiscoveryProvider></WorkspaceProvider>)}
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Live network prohibited')}));vi.spyOn(navigator,'onLine','get').mockReturnValue(true)})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('applications UI with mocked Supabase, not live checks',()=>{
  it('starts recipient empty, requires verification and resume, then shows exact review and requires final confirmation',async()=>{
    const api=backend();open(api)
    const recipient=await screen.findByLabelText('Employer application email') as HTMLInputElement
    expect(recipient.value).toBe('');expect(document.body.textContent).not.toContain('alerts@example.invalid')
    expect((screen.getByRole('button',{name:'Review final email'}) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(recipient,{target:{value:'employer@example.invalid'}})
    fireEvent.click(screen.getByLabelText(/I verified/))
    fireEvent.change(screen.getByLabelText('Private resume PDF'),{target:{value:rid}})
    fireEvent.click(screen.getByRole('button',{name:'Save draft'}))
    await waitFor(()=>expect((screen.getByRole('button',{name:'Review final email'}) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button',{name:'Review final email'}))
    await screen.findByRole('heading',{name:'Final email review'})
    expect(screen.getByText('employer@example.invalid')).toBeTruthy();expect(document.querySelector('.email-body')?.textContent).toBe(api.state.application.body);expect(screen.getByText(/Fixture resume.pdf/)).toBeTruthy()
    const send=screen.getByRole('button',{name:'Confirm and send email'}) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/I checked the recipient/));expect(send.disabled).toBe(false)
    fireEvent.click(send);fireEvent.click(send)
    await screen.findByText(/Gmail accepted this email/)
    expect(api.invoke.mock.calls.filter(c=>c[1].body.action==='application_send')).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('clears recipient verification after editing and keeps drafts only in memory',async()=>{
    const api=backend();api.state.application.recipient='first@example.invalid';api.state.application.recipient_verified=true;open(api)
    fireEvent.change(await screen.findByLabelText('Employer application email'),{target:{value:'other@example.invalid'}})
    expect((screen.getByLabelText(/I verified/) as HTMLInputElement).checked).toBe(false)
    expect(localStorage.length).toBe(0)
    vi.spyOn(navigator,'onLine','get').mockReturnValue(false);act(()=>window.dispatchEvent(new Event('offline')))
    expect((screen.getByRole('button',{name:'Save draft'}) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByDisplayValue('other@example.invalid')).toBeTruthy()
  })
  it('disables sending without fresh consent',async()=>{
    const api=backend('ready');api.state.send=false;open(api)
    await screen.findByRole('heading',{name:'Final email review'})
    expect((screen.getByRole('button',{name:'Confirm and send email'}) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(/I checked the recipient/) as HTMLInputElement).disabled).toBe(true)
  })
  it('does not offer sending or retry for delivery unknown and explains manual reconciliation',async()=>{
    const api=backend('delivery_unknown');open(api)
    await screen.findByRole('heading',{name:'Reconcile in Gmail'})
    expect(screen.queryByRole('button',{name:'Confirm and send email'})).toBeNull()
    expect(screen.getByText(/JobPilot will not retry this application/)).toBeTruthy()
    expect((screen.getByRole('button',{name:'I found the sent email'}) as HTMLButtonElement).disabled).toBe(true)
  })
  it('tracks externally sent applications without claiming JobPilot sent them',async()=>{
    const api=backend();open(api);await screen.findByLabelText('Employer application email')
    fireEvent.click(screen.getByText('Track an application sent outside JobPilot'))
    fireEvent.change(screen.getByLabelText('When you sent it'),{target:{value:'2026-01-01T10:00'}})
    fireEvent.change(screen.getByLabelText('Where and how you applied'),{target:{value:'Manually submitted through employer website'}})
    fireEvent.click(screen.getByRole('button',{name:'Record as sent outside JobPilot'}))
    await screen.findByText(/JobPilot did not send this application/)
    expect(api.invoke.mock.calls.some(c=>c[1].body.action==='application_send')).toBe(false)
  })
  it('leaves a timeout visible and requires refresh without automatically retrying',async()=>{
    const api=backend('ready');api.state.failure=true;open(api)
    fireEvent.click(await screen.findByLabelText(/I checked the recipient/));fireEvent.click(screen.getByRole('button',{name:'Confirm and send email'}))
    await screen.findByRole('alert');expect(document.body.textContent).toContain('do not send another email until reconciled')
    expect(document.body.textContent).not.toContain('private diagnostic');expect(api.invoke).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button',{name:'Confirm and send email'}) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(/I checked the recipient/) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button',{name:'Back to applications'}))
    fireEvent.click(screen.getByRole('button',{name:'Open application'}))
    expect((screen.getByLabelText(/I checked the recipient/) as HTMLInputElement).disabled).toBe(true)
    api.state.failure=false
    fireEvent.click(screen.getByRole('button',{name:'Refresh status'}))
    await waitFor(()=>expect((screen.getByLabelText(/I checked the recipient/) as HTMLInputElement).disabled).toBe(false))
    expect((screen.getByRole('button',{name:'Confirm and send email'}) as HTMLButtonElement).disabled).toBe(true)
  })
  it('discards confirmed edits when refresh returns the unchanged saved revision',async()=>{
    const api=backend();open(api)
    const input=await screen.findByLabelText('Employer application email')
    fireEvent.change(input,{target:{value:'unsaved@example.invalid'}})
    vi.spyOn(window,'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button',{name:'Refresh status'}))
    await waitFor(()=>expect((screen.getByLabelText('Employer application email') as HTMLInputElement).value).toBe(''))
    expect(api.state.application.revision).toBe(1)
  })
  it('never loads application records for a signed-in non-owner',async()=>{
    const api=backend();api.state.owner=false;open(api);await screen.findByText('Owner access required');expect(api.from).not.toHaveBeenCalled()
  })
})
