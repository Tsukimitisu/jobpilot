import { Link } from 'react-router-dom'
import { discoveryAction, discoveryError, type ImportRun } from '../lib/discovery'
import { DiscoveryStatus } from './DiscoveryStatus'
import { useDiscovery } from './useDiscovery'
import { useWorkspace } from './useWorkspace'

const philippineTime = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(value)) + ' PHT'
  : 'Never'

export function ImportHistory({ runs }: { runs: ImportRun[] }) {
  const { data } = useDiscovery()
  return <><h2>Import history</h2>{runs.length === 0 ? <p>No imports yet.</p> : <ul className="source-list">{runs.map(run => <li key={run.id}>
    <h3>{data?.sources.find(source => source.id === run.source_id)?.name ?? 'Source'}</h3>
    <p>{run.automation_run_id ? 'Scheduled' : 'Manual'} · {run.status} · {philippineTime(run.started_at)}</p>
    <p>{run.imported_count} added · {run.duplicate_count} duplicates</p>
    {run.error_code && <p className="error-message">{discoveryError(run.error_code)}</p>}
  </li>)}</ul>}</>
}

export function AutomationPage() {
  const { data: workspace, client } = useWorkspace()
  const { data, loading, error, online, busy, run, refresh, checkedAt } = useDiscovery()
  if (!workspace?.owner) return <><h1>Automation</h1><p>Owner access required</p></>
  const enabled = data?.automation?.enabled === true
  const latest = data?.automationRuns?.[0]
  const sources = data?.sources.filter(source => source.kind !== 'manual') ?? []
  const overdue = enabled && !!data?.automation?.next_run_at && checkedAt > Date.parse(data.automation.next_run_at) + 600000
  const interrupted = latest?.status === 'running' && checkedAt > Date.parse(latest.lease_until)
  return <>
    <header className="page-heading"><h1>Automation</h1><p>Discover jobs while your laptop is off. You stay in control of every application.</p></header>
    <DiscoveryStatus />
    <section className="panel settings-section" aria-labelledby="schedule-heading">
      <div className="section-heading compact"><h2 id="schedule-heading">Scheduled discovery</h2><span className="badge">{!data ? 'Checking…' : enabled ? 'Enabled' : 'Off'}</span></div>
      <p>Every hour, on the hour in Philippine time (PHT, UTC+8). Only your confirmed Gmail label and enabled Greenhouse boards are checked.</p>
      <p className="fine-print">This imports jobs only. It never creates or sends applications, submits forms, or sends follow-ups.</p>
      <dl className="job-fit">
        <div><dt>Last run</dt><dd>{latest ? `${philippineTime(latest.started_at)} · ${interrupted ? 'Interrupted' : latest.status}` : 'No scheduled runs yet'}</dd></div>
        <div><dt>Next expected run</dt><dd>{enabled ? philippineTime(data?.automation?.next_run_at) : 'None while off'}</dd></div>
      </dl>
      {enabled && !latest && <p className="notice">Waiting for the first scheduled run. Enabling this control requires the administrator’s scheduler setup in PHASE5.md.</p>}
      {(overdue || interrupted) && <p className="error-message" role="alert">{overdue ? 'The expected check is overdue.' : 'The last worker did not finish.'} Check Cron activity and scheduler credentials using PHASE5.md. Refresh status after recovery. Existing jobs are preserved.</p>}
      {latest?.error_code && <p className="error-message">{discoveryError(latest.error_code)}</p>}
      <div className="action-row">
        <button className="button" disabled={!data || !!error || loading || busy || !online} onClick={() => void run(async () => {
          await discoveryAction(client, { action: 'set_automation', enabled: !enabled })
          return enabled ? 'Automation paused. Existing jobs are preserved.' : 'Automation enabled. The next hourly check will use your enabled sources.'
        })}>{enabled ? 'Pause automation' : 'Enable automation'}</button>
        <button className="button button-secondary" disabled={loading || busy || !online} onClick={() => void refresh()}>Refresh automation status</button>
      </div>
      <p className="fine-print">Pausing stops further imports; an already dispatched read request may finish. Up to three sources are checked each hour, oldest attempted first. Partial imports continue on a later check.</p>
    </section>
    <section className="panel settings-section" aria-labelledby="automated-sources"><h2 id="automated-sources">Sources & results</h2>
      <Link className="text-link" to="/settings">Manage sources & Gmail access</Link>
      {!sources.some(source => source.enabled) && <p>No enabled sources. Confirm a Gmail label or add a Greenhouse board in Settings.</p>}
      <ul className="source-list">{sources.map(source => {
        const result = data?.scheduledResults?.find(item => item.source_id === source.id) ?? data?.runs.find(item => item.source_id === source.id && item.automation_run_id)
        const reconnect = source.kind === 'gmail' && data?.connection?.status === 'reconnect_required'
        return <li key={source.id}><div className="resume-title"><h3>{source.name}</h3><span className="badge">{source.enabled ? 'Enabled' : 'Paused'}</span></div>
          <p>{source.kind === 'gmail' ? 'Gmail label' : 'Greenhouse board'} · {source.source_key}</p>
          {reconnect && <p className="error-message">Reconnect required. Reconnect Gmail in Settings to resume this source.</p>}
          <p>{result ? `${philippineTime(result.started_at)} · ${result.status} · ${result.imported_count} added · ${result.duplicate_count} duplicates` : 'No recent scheduled result'}</p>
          {result?.error_code && <p className="error-message">{discoveryError(result.error_code)}</p>}
          {source.cursor && <p className="fine-print">More jobs remain. The saved cursor will continue on a later check.</p>}
        </li>
      })}</ul>
    </section>
    <Link className="text-link" to="/dashboard">Back to dashboard</Link>
  </>
}
