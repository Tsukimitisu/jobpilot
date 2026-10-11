import { discoveryAction, discoveryError, displayDate, type Source } from '../lib/discovery'
import { useDiscovery } from './useDiscovery'
import { useWorkspace } from './useWorkspace'

export function DiscoveryStatus() {
  const { error, loading, data, actionError, notice, busy } = useDiscovery()
  return <>
    {loading && <p role="status">Refreshing job discovery…</p>}
    {error && <p className="error-message" role="alert">{error} {data ? 'Previously loaded data may be out of date.' : ''}</p>}
    {actionError && <p className="error-message" role="alert">{actionError}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {busy && <p role="status">Working… Imports can take up to two minutes.</p>}
  </>
}
export function SourceList({ configure = false }: { configure?: boolean }) {
  const { client } = useWorkspace()
  const { data, online, busy, run, checkedAt } = useDiscovery()
  const sources = data?.sources.filter(source => source.kind !== 'manual') ?? []
  async function importJobs(source: Source) {
    await run(async () => {
      const result = await discoveryAction<{ added: number; duplicates: number; more: boolean }>(client, { action: 'import', sourceId: source.id })
      return `${source.name}: ${result.added} added, ${result.duplicates} already imported.${result.more ? ' More available; select Continue import.' : ' Import complete.'}`
    })
  }
  return <ul className="source-list">{sources.map(source => {
    const latest = data?.runs.find(item => item.source_id === source.id)
    const running = latest?.status === 'running'
    const stale = running && checkedAt - Date.parse(latest.started_at) > 300000
    return <li key={source.id}>
      <div className="resume-title"><h3>{source.name}</h3><span className="badge">{source.kind === 'gmail' ? 'Gmail label' : 'Greenhouse'} · {source.enabled ? 'Enabled' : 'Paused'}</span></div>
      <p className="fine-print">Last successful import: {displayDate(source.last_success_at)}</p>
      {latest && <p>{stale ? 'Interrupted — retry to recover' : `Last run: ${latest.status}`} · {latest.imported_count} added · {latest.duplicate_count} duplicates</p>}
      {latest?.error_code && <p className="error-message">{discoveryError(latest.error_code)}</p>}
      <div className="action-row"><button className="button button-secondary" disabled={busy || !online || !source.enabled || (!!running && !stale) || (source.kind === 'gmail' && data?.connection?.status !== 'connected')} onClick={() => void importJobs(source)}>{source.cursor ? 'Continue import' : 'Import now'}<span className="sr-only"> from {source.name}</span></button>
        {configure && <button className="button button-secondary" disabled={busy || !online || (!!running && !stale)} onClick={() => void run(async () => { await discoveryAction(client, { action: 'toggle_source', sourceId: source.id, enabled: !source.enabled }); return `${source.name} ${source.enabled ? 'paused' : 'enabled'}.` })}>{source.enabled ? 'Pause source' : 'Enable source'}<span className="sr-only"> {source.name}</span></button>}
      </div>
    </li>
  })}</ul>
}
