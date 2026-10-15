import { useState } from 'react'
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
export function SourceList({ configure = false, adzunaStatus }: { configure?: boolean; adzunaStatus?: string }) {
  const { client } = useWorkspace()
  const { data, online, busy, run, checkedAt } = useDiscovery()
  const [preview,setPreview]=useState<{id:string;company:string|null;board:string;titles:(string|null)[]}|null>(null)
  const sources = data?.sources.filter(source => source.kind !== 'manual' && !source.removed_at) ?? []
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
    const nextEligible=[source.next_eligible_at,source.provider_retry_at].filter((value):value is string=>!!value).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]
    const waiting=!!nextEligible && Date.parse(nextEligible)>checkedAt
    const providerWaiting=!!source.provider_retry_at && Date.parse(source.provider_retry_at)>checkedAt
    return <li key={source.id}>
      <div className="resume-title"><h3>{source.name}</h3><span className="badge">{source.kind === 'gmail' ? 'Gmail label' : source.kind} · {source.enabled ? 'Enabled' : 'Disabled'}</span></div>
      <p className="fine-print">Last attempted: {displayDate(source.last_attempted_at??latest?.started_at)} · Next eligible check: {nextEligible?displayDate(nextEligible):'When enabled and requested or scheduled'}</p>
      <p className="fine-print">Last successful import: {displayDate(source.last_success_at)}</p>
      <p>{source.cursor?'More results remain; the next eligible check resumes from the saved checkpoint.':'Ready to start a fresh pass.'} {source.last_error_code==='rate_limited' && waiting?'Rate limited — waiting for provider retry time.':''}</p>
      {providerWaiting && <p role="status">Provider rate limit or retry delay applies to every {source.kind} source. Waiting until {displayDate(source.provider_retry_at)}.</p>}
      <p>Last attempt: {source.last_added??latest?.imported_count??0} added · {source.last_duplicates??latest?.duplicate_count??0} skipped as duplicates</p>
      {source.kind==='adzuna' && <p>Adzuna: {adzunaStatus??(source.last_error_code==='not_configured'?'Not configured':'Check configuration in Settings')}</p>}
      {latest && <p>{stale ? 'Interrupted — retry to recover' : `Last run: ${latest.status}`} · {latest.imported_count} added · {latest.duplicate_count} duplicates</p>}
      {(source.last_error_code??latest?.error_code) && <p className="error-message">{discoveryError(source.last_error_code??latest?.error_code??null)}</p>}
      {preview?.id===source.id && <div className="notice" role="status"><p>Board: {preview.board} · Company: {preview.company??'Not supplied by provider'}</p><ul>{preview.titles.map((title,i)=><li key={i}>{title??'Title unknown'}</li>)}</ul>{!preview.titles.length && <p>No preview titles returned.</p>}</div>}
      <div className="action-row"><button className="button button-secondary" disabled={busy || !online || waiting || !source.enabled || (!!running && !stale) || (source.kind === 'gmail' && data?.connection?.status !== 'connected')} onClick={() => void importJobs(source)}>{source.cursor ? 'Continue import' : 'Import now'}<span className="sr-only"> from {source.name}</span></button>
        {configure && <button className="button button-secondary" aria-label={`Test source ${source.name}`} disabled={busy || !online || waiting || (!!running&&!stale)} onClick={()=>void run(async()=>{const result=await discoveryAction<{company:string|null;board:string;titles:(string|null)[]}>(client,{action:'test_source',sourceId:source.id});setPreview({...result,id:source.id});return 'Source test complete. No jobs imported.'})}>Test source<span className="sr-only"> {source.name}</span></button>}
        {configure && source.kind!=='gmail' && <button className="button button-secondary" disabled={busy || !online} onClick={()=>void run(async()=>{await discoveryAction(client,{action:'remove_source',sourceId:source.id});return 'Source removed from discovery. Imported jobs and attribution retained.'})}>Remove source<span className="sr-only"> {source.name}</span></button>}
        {configure && <button className="button button-secondary" disabled={busy || !online || (!!running && !stale)} onClick={() => void run(async () => { await discoveryAction(client, { action: 'toggle_source', sourceId: source.id, enabled: !source.enabled }); return `${source.name} ${source.enabled ? 'paused' : 'enabled'}.` })}>{source.enabled ? 'Pause source' : 'Enable source'}<span className="sr-only"> {source.name}</span></button>}
      </div>
    </li>
  })}</ul>
}
