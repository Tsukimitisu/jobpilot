import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { discoveryAction, discoveryError, displayDate, gmailStatus } from '../lib/discovery'
import { OwnerContent } from './WorkspaceContext'
import { useWorkspace } from './useWorkspace'
import { useDiscovery } from './useDiscovery'
import { DiscoveryStatus, SourceList } from './DiscoveryStatus'

export function SourceSettings() {
  return <OwnerContent><SourceSettingsContent /></OwnerContent>
}
function SourceSettingsContent() {
  const { client, dirty } = useWorkspace()
  const { data, busy, online, loading, refresh, run } = useDiscovery()
  const [params, setParams] = useSearchParams()
  const [email, setEmail] = useState<string | null>(null)
  const [board, setBoard] = useState('')
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([])
  const [label, setLabel] = useState('')
  const connection = data?.connection
  const disabled = busy || !online || !data
  const callback = params.get('gmail')
  async function connect(event?: FormEvent, send = false) {
    event?.preventDefault()
    if (dirty && !window.confirm('Connect Gmail and leave this page? Unsaved profile changes will be discarded.')) return
    await run(async () => {
      const result = await discoveryAction<{ url: string }>(client, { action: send ? 'connect_send' : 'connect', email: email ?? connection?.expected_email ?? '' })
      const url = new URL(result.url)
      if (url.origin !== 'https://accounts.google.com') throw new Error('Unexpected connection URL')
      window.location.assign(url.href)
      return 'Opening Google consent…'
    })
  }
  return <>
    <DiscoveryStatus />
    {callback && <div className="notice" role="status"><p>{callback === 'connected' ? 'Gmail consent returned. Check the saved connection status below.' : discoveryError(callback)}</p><button className="button button-secondary" onClick={() => { params.delete('gmail'); setParams(params, { replace: true }) }}>Dismiss connection notice</button></div>}
    <section className="panel settings-section" aria-labelledby="gmail-heading">
      <div className="resume-title"><h2 id="gmail-heading">Gmail connection</h2><span className="badge">{data ? gmailStatus(connection ?? null) : loading ? 'Checking…' : 'Unavailable'}</span></div>
      <p>Connect Gmail to import your chosen job-alert label. Sending is optional and requires fresh Google consent plus confirmation for each email.</p>
      <p>{connection?.send_consented_at && connection.granted_scopes?.includes('https://www.googleapis.com/auth/gmail.send') ? 'Sending consent saved. Google checks access again when you send.' : 'Sending is disabled until you grant fresh sending consent.'}</p>
      {connection?.connected_email && <p className="account-value">{connection.connected_email}</p>}
      {connection?.checked_at && <p className="fine-print">Last verified with Google: {displayDate(connection.checked_at)}. Use Check Gmail access to detect revoked permission.</p>}
      {connection?.error_code && <p className="error-message">{discoveryError(connection.error_code)}</p>}
      <form onSubmit={event => void connect(event)}>
        <div className="field"><label htmlFor="gmail-address">Gmail address to connect</label><input id="gmail-address" type="email" autoCapitalize="none" autoComplete="email" required maxLength={254} value={email ?? connection?.expected_email ?? ''} disabled={disabled} onChange={event => setEmail(event.target.value)} /><span className="fine-print">Google must return this exact mailbox address. This does not change your JobPilot login or profile email.</span></div>
        <button className="button" disabled={disabled}>{connection?.status === 'connected' || connection?.status === 'reconnect_required' ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
      </form>
      <div className="action-row">
        <button className="button button-secondary" disabled={disabled} onClick={() => void connect(undefined, true)}>Enable Gmail sending / renew consent</button>
        <button className="button button-secondary" disabled={disabled || !connection || connection.status === 'disconnected'} onClick={() => void run(async () => { await discoveryAction(client, { action: 'check_gmail' }); return 'Gmail access verified with Google.' })}>Check Gmail access</button>
        <button className="button button-secondary" disabled={disabled || !connection || connection.status === 'disconnected'} onClick={() => void run(async () => { await discoveryAction(client, { action: 'disconnect' }); setLabels([]); setLabel(''); return 'Gmail disconnected. Stored credentials removed; imported jobs retained.' })}>Disconnect Gmail</button>
      </div>
      <p className="fine-print">Sending consent requests gmail.send alongside gmail.readonly. Cancelled consent keeps your current connection. Disconnect removes JobPilot’s stored access; imported jobs and applications stay saved.</p>
    </section>
    <section className="panel settings-section" aria-labelledby="sources-heading"><h2 id="sources-heading">Job sources</h2>
      <p>Start with a custom Gmail label named <strong>JobPilot/Alerts</strong>, or choose another existing custom label. Add labels to messages in Gmail first.</p>
      <button className="button button-secondary" disabled={disabled || connection?.status !== 'connected'} onClick={() => void run(async () => {
        const result = await discoveryAction<{ labels: { id: string; name: string }[] }>(client, { action: 'labels' })
        setLabels(result.labels)
        const existing = data?.sources.find(source => source.kind === 'gmail')?.source_key
        setLabel(result.labels.find(item => item.id === existing)?.id ?? result.labels.find(item => item.name === 'JobPilot/Alerts')?.id ?? '')
        return result.labels.length ? 'Labels loaded. Confirm the one label to import.' : 'No custom labels found. Create JobPilot/Alerts in Gmail, then load labels again.'
      })}>Load Gmail labels</button>
      {labels.length > 0 && <form onSubmit={event => { event.preventDefault(); void run(async () => { await discoveryAction(client, { action: 'save_gmail_label', labelId: label }); return 'Gmail import label confirmed.' }) }}>
        <div className="field"><label htmlFor="gmail-label">Import label</label><select id="gmail-label" value={label} required disabled={disabled} onChange={event => setLabel(event.target.value)}><option value="">Choose a label</option>{labels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><button className="button" disabled={disabled || !label}>Confirm label</button>
      </form>}
      <form onSubmit={event => { event.preventDefault(); void run(async () => { await discoveryAction(client, { action: 'add_greenhouse', board }); setBoard(''); return 'Greenhouse source saved. Select Import now to load its public jobs.' }) }}>
        <div className="field"><label htmlFor="greenhouse-board">Greenhouse company board token</label><input id="greenhouse-board" value={board} pattern="[a-zA-Z0-9_-]{1,100}" required maxLength={100} disabled={disabled} onChange={event => setBoard(event.target.value)} /><span className="fine-print">Enter the token from the company’s Greenhouse board URL, not the full URL. Only its public job-board API is used.</span></div><button className="button button-secondary" disabled={disabled}>Add Greenhouse source</button>
      </form>
      {data && !data.sources.some(source => source.kind !== 'manual') && <p className="notice">No import sources configured. Manual job entry is available in Jobs.</p>}
      <SourceList configure />
      <button className="button button-secondary" disabled={busy || loading || !online} onClick={() => void refresh()}>Refresh source status</button>
    </section>
  </>
}
