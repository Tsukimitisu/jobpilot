import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { applicationAction, applicationLabels, loadApplications, type Application } from '../lib/applications'
import { discoveryError, displayDate } from '../lib/discovery'
import { workspaceMessage } from '../lib/workspace'
import { validEmailText, validRecipient } from '../../supabase/functions/_shared/application-data'
import { OwnerContent } from './WorkspaceContext'
import { useWorkspace } from './useWorkspace'
import { useDiscovery } from './useDiscovery'

export function ApplicationsPage() {
  return <><header className="page-heading"><h1>Applications</h1><p>Prepare an email, review every detail, and choose when to send.</p></header><OwnerContent><ApplicationsContent /></OwnerContent></>
}
function ApplicationsContent() {
  const { client, online } = useWorkspace()
  const { data: discovery } = useDiscovery()
  const [params,setParams] = useSearchParams()
  const [applications,setApplications] = useState<Application[]>([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [filter,setFilter] = useState('all')
  const [editorVersion,setEditorVersion] = useState(0)
  const [uncertainIds,setUncertainIds] = useState<string[]>([])
  const active = useRef(false)
  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await loadApplications(client)
      const values = await Promise.all(rows.map(a => a.status === 'sending' ? applicationAction(client,{ action: 'application_refresh', id: a.id, revision: a.revision }) : a))
      if (active.current) setApplications(values)
    } catch (reason) { if (active.current) setError(workspaceMessage(reason)) }
    finally { if (active.current) setLoading(false) }
  },[client])
  useEffect(() => { active.current = true; let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) void refresh() }); return () => { cancelled = true; active.current = false } },[refresh])
  const selected = applications.find(a => a.id === params.get('application'))
  return <>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loading && <p role="status">Loading applications…</p>}
    {selected ? <ApplicationEditor key={`${selected.id}:${selected.revision}:${editorVersion}`} application={selected} sendUncertain={uncertainIds.includes(selected.id)} onSendUncertain={() => setUncertainIds(ids => ids.includes(selected.id) ? ids : [...ids,selected.id])} onSaved={next => { setApplications(rows => rows.map(a => a.id === next.id ? next : a)); setUncertainIds(ids => ids.filter(id => id !== next.id)); setEditorVersion(v => v + 1) }} onClose={() => setParams({})} /> : <>
      <div className="action-row"><Link className="text-link" to="/jobs">Create a draft from a saved or reviewed job</Link><button className="button button-secondary" disabled={loading || !online} onClick={() => void refresh()}>Refresh applications</button></div>
      <div className="field"><label htmlFor="application-filter">Application status</label><select id="application-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All applications</option>{Object.entries(applicationLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {!loading && !error && applications.length === 0 && <section className="panel empty-state"><h2>No applications yet.</h2><p>Save or review a job, then choose Create application draft. You can also record an application sent outside JobPilot from its draft.</p></section>}
      <div className="job-list">{applications.filter(a => filter === 'all' || a.status === filter).map(a => {
        const job = discovery?.jobs.find(j => j.id === a.job_id)
        return <article className="panel job-item" key={a.id}><div className="resume-title"><h2>{job?.title ?? a.subject}</h2><span className="badge">{applicationLabels[a.status]}</span></div><p>{job?.company ?? 'Linked job'} · {a.recipient || 'Employer email needed'}</p><p className="fine-print">Updated {displayDate(a.updated_at)}</p><button className="button button-secondary" onClick={() => setParams({ application: a.id })}>Open application</button></article>
      })}</div>
    </>}
  </>
}
function ApplicationEditor({ application: a, onSaved, onClose, sendUncertain, onSendUncertain }: { application: Application; onSaved: (a: Application) => void; onClose: () => void; sendUncertain: boolean; onSendUncertain: () => void }) {
  const { client, data: workspace, online } = useWorkspace()
  const { data: discovery } = useDiscovery()
  const [recipient,setRecipient] = useState(a.recipient)
  const [verified,setVerified] = useState(a.recipient_verified)
  const [subject,setSubject] = useState(a.subject)
  const [body,setBody] = useState(a.body)
  const [resume,setResume] = useState(a.resume_id ?? '')
  const [editing,setEditing] = useState(a.status === 'draft' || a.status === 'failed')
  const [confirmed,setConfirmed] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [note,setNote] = useState('')
  const [sentDate,setSentDate] = useState('')
  const submitting = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const reviewRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const dirty = recipient !== a.recipient || verified !== a.recipient_verified || subject !== a.subject || body !== a.body || resume !== (a.resume_id ?? '')
  useEffect(() => { if (error) errorRef.current?.focus() },[error])
  useEffect(() => { if (a.status === 'ready') reviewRef.current?.focus(); else headingRef.current?.focus() },[a.status])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn)
  },[dirty])
  const connection = discovery?.connection
  const sendAllowed = !sendUncertain && connection?.status === 'connected' && !!connection.send_consented_at && connection.granted_scopes?.includes('https://www.googleapis.com/auth/gmail.send') && a.sender_email === connection.connected_email
  const disabled = busy || !online
  async function act(action: string, extra = {}) {
    if (submitting.current || !online) return
    submitting.current = true; setBusy(true); setError(''); setConfirmed(false)
    try { onSaved(await applicationAction(client,{ action, id: a.id, revision: a.revision, ...extra })) }
    catch (reason) {
      if (action === 'application_send') onSendUncertain()
      setError(action === 'application_send' ? `${workspaceMessage(reason)} Sending may still be running. Refresh status; do not send another email until reconciled.` : workspaceMessage(reason))
    }
    finally { submitting.current = false; setBusy(false) }
  }
  const job = discovery?.jobs.find(j => j.id === a.job_id)
  return <section className="panel application-editor" aria-busy={busy}>
    <div className="resume-title"><h2 ref={headingRef} tabIndex={-1} aria-describedby="application-current-status">{job?.title ?? a.subject}</h2><span id="application-current-status" className="badge" role="status">{applicationLabels[a.status]}</span></div>
    <p><Link to={`/jobs#job-${a.job_id}`}>View linked job</Link>{job?.company ? ` · ${job.company}` : ''}</p>
    {error && <p role="alert" className="error-message" ref={errorRef} tabIndex={-1}>{error}</p>}
    {a.error_code && <p className="error-message">{discoveryError(a.error_code)}</p>}
    {editing ? <form onSubmit={e => { e.preventDefault(); void act('application_save',{ recipient, recipient_verified: verified, subject, body, resume_id: resume || null }) }}>
      <p>Enter the employer’s application address from a source you trust. The job-alert sender is not an employer recipient. Check every statement before sending.</p>
      <div className="field"><label htmlFor="application-recipient">Employer application email</label><input id="application-recipient" type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} value={recipient} disabled={disabled} onChange={e => { setRecipient(e.target.value); setVerified(false) }} aria-describedby="recipient-help" /><span id="recipient-help" className="fine-print">One address only. A recipient is required before review.</span></div>
      <div className="choice-list"><label><input type="checkbox" checked={verified} disabled={disabled || !validRecipient(recipient)} onChange={e => setVerified(e.target.checked)} />I verified that this address accepts applications for this job.</label></div>
      <div className="field"><label htmlFor="application-subject">Subject</label><input id="application-subject" required maxLength={200} value={subject} disabled={disabled} onChange={e => setSubject(e.target.value)} /></div>
      <div className="field"><label htmlFor="application-body">Email body</label><textarea id="application-body" rows={12} required maxLength={20000} value={body} disabled={disabled} onChange={e => setBody(e.target.value)} /></div>
      <div className="field"><label htmlFor="application-resume">Private resume PDF</label><select id="application-resume" value={resume} disabled={disabled} onChange={e => setResume(e.target.value)}><option value="">Choose a resume</option>{workspace?.resumes.filter(r => r.status === 'ready').map(r => <option key={r.id} value={r.id}>{r.original_name} ({r.byte_size.toLocaleString()} bytes)</option>)}</select><span className="fine-print">Selected files stay private and are attached on the backend. <Link to="/resumes">Manage resumes</Link>.</span></div>
      <p className="fine-print">Unsaved edits stay in memory and are lost when you leave. Save stores the draft privately on the backend.</p>
      <div className="action-row"><button className="button" disabled={disabled || (recipient !== '' && !validRecipient(recipient)) || !validEmailText(subject,body)}>Save draft</button>
        {!dirty && a.status === 'draft' && <button type="button" className="button button-secondary" disabled={disabled || !validRecipient(recipient) || !verified || !resume} onClick={() => void act('application_ready')}>Review final email</button>}</div>
    </form> : <section ref={reviewRef} tabIndex={-1} aria-labelledby="final-email-heading" className="email-review">
      <h3 id="final-email-heading">{a.status === 'ready' ? 'Final email review' : 'Email record'}</h3>
      <dl className="job-fit"><div><dt>From</dt><dd>{a.sender_email ?? 'Connect Gmail, then edit and review again'}</dd></div><div><dt>To</dt><dd>{a.recipient || 'Not recorded'}</dd></div><div><dt>Subject</dt><dd>{a.subject}</dd></div><div><dt>Attachment</dt><dd>{a.resume_name ?? 'No attachment recorded'}{a.resume_bytes ? ` · ${a.resume_bytes.toLocaleString()} bytes · PDF` : ''}</dd></div></dl>
      {a.resume_sha256 && <p className="fine-print wrap-anywhere">Sent filename: resume-{a.resume_id}.pdf. This is the exact private PDF selected above; its contents are checked again before sending.</p>}
      <div className="email-body">{a.body}</div>
      {a.status === 'ready' && <>
        {sendUncertain ? <p className="notice">Sending is locked until Refresh status confirms the saved outcome.</p> : !sendAllowed && <p className="notice">Enable sending in <Link to="/settings">Gmail settings</Link>, then edit and review this draft again to confirm the sending account.</p>}
        <p>Gmail acceptance does not prove delivery to the employer or that the application was read.</p>
        <div className="choice-list"><label><input type="checkbox" checked={confirmed} disabled={disabled || !sendAllowed} onChange={e => setConfirmed(e.target.checked)} />I checked the recipient, exact email, and selected PDF. Send this application now.</label></div>
        <div className="action-row"><button className="button" disabled={disabled || !sendAllowed || !confirmed} onClick={() => void act('application_send',{ confirmed: true })}>{busy ? 'Sending…' : 'Confirm and send email'}</button><button className="button button-secondary" disabled={disabled} onClick={() => { setConfirmed(false); setEditing(true) }}>Edit draft</button></div>
      </>}
    </section>}
    {a.status === 'sending' && <p role="status" className="notice">The backend reserved this email for sending. Refresh status. If it remains unresolved for three minutes, it becomes Delivery unknown and must be checked manually.</p>}
    {a.status === 'delivery_unknown' && <section className="settings-section"><h3>Reconcile in Gmail</h3><p>Check Sent in <strong>{a.sender_email}</strong> for this recipient, subject, and time: {displayDate(a.sending_at)}. You can search Gmail for <span className="wrap-anywhere">rfc822msgid:{a.attempt_id}@jobpilot.invalid</span>. A missing search result does not prove it was not sent. JobPilot will not retry this application.</p><div className="field"><label htmlFor="reconcile-note">What did you find? (at least 10 characters)</label><textarea id="reconcile-note" value={note} maxLength={2000} disabled={disabled} onChange={e => setNote(e.target.value)} /></div><div className="action-row"><button className="button button-secondary" disabled={disabled || note.trim().length < 10} onClick={() => void act('application_reconcile',{ outcome: 'sent', note })}>I found the sent email</button><button className="button button-secondary" disabled={disabled || note.trim().length < 10} onClick={() => void act('application_reconcile',{ outcome: 'not_found', note })}>Record check; keep delivery unknown</button></div></section>}
    {a.status === 'sent' && <p className="notice">{a.gmail_message_id ? `Gmail accepted this email on ${displayDate(a.sent_at)}. Gmail message ID: ${a.gmail_message_id}.` : 'You manually confirmed this email in Gmail Sent. JobPilot did not receive a Gmail acceptance acknowledgement.'}</p>}
    {a.status === 'external' && <p className="notice">Sent outside JobPilot on {displayDate(a.external_sent_at)}. This is your manual record; JobPilot did not send this application.</p>}
    {a.reconciliation_note && <p className="job-description">Tracking note: {a.reconciliation_note}</p>}
    {['draft','ready','failed'].includes(a.status) && <details className="settings-section"><summary>Track an application sent outside JobPilot</summary><p>Record an email or website application you already submitted yourself. This action does not send anything. Save any edits first.</p><div className="field"><label htmlFor="external-date">When you sent it</label><input id="external-date" type="datetime-local" value={sentDate} disabled={disabled} onChange={e => setSentDate(e.target.value)} /></div><div className="field"><label htmlFor="external-note">Where and how you applied</label><textarea id="external-note" maxLength={2000} value={note} disabled={disabled} onChange={e => setNote(e.target.value)} /></div><button className="button button-secondary" disabled={disabled || dirty || !sentDate || !note.trim() || !Number.isFinite(Date.parse(sentDate))} onClick={() => void act('application_external',{ sent_at: new Date(sentDate).toISOString(), note })}>Record as sent outside JobPilot</button></details>}
    <div className="action-row settings-section"><button className="button button-secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard unsaved application edits?')) onClose() }}>Back to applications</button><button className="button button-secondary" disabled={disabled} onClick={() => { if (!dirty || window.confirm('Discard unsaved edits and refresh this application?')) void act('application_refresh') }}>Refresh status</button></div>
  </section>
}
