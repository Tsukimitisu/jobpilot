import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { applicationAction } from '../lib/applications'
import { canonicalUrl, duplicateSuggestions, matchJob } from '../../supabase/functions/_shared/discovery'
import { scoreSearch } from '../../supabase/functions/_shared/search'
import { discoveryAction, displayDate, saveReview, type Job, type Review } from '../lib/discovery'
import { OwnerContent } from './WorkspaceContext'
import { useWorkspace } from './useWorkspace'
import { useDiscovery } from './useDiscovery'
import { DiscoveryStatus, SourceList } from './DiscoveryStatus'

const emptyEntry = { url: '', description: '', title: '', company: '', location: '', work_mode: '' }
export function JobsPage() {
  return <><header className="page-heading"><h1>Jobs</h1><p>Discover opportunities, understand the fit, and decide what to keep.</p></header><OwnerContent><JobsContent /></OwnerContent></>
}
function JobsContent() {
  const navigate = useNavigate()
  const { client, ownerId, data: workspace } = useWorkspace()
  const { data, online, busy, loading, refresh, run, loadMore } = useDiscovery()
  const [entry, setEntry] = useState(emptyEntry)
  const [query, setQuery] = useState('')
  const [disposition, setDisposition] = useState('active')
  const [sourceId, setSourceId] = useState('')
  const [mode, setMode] = useState('')
  const [reviewOnly, setReviewOnly] = useState(false)
  const [sort, setSort] = useState('match')
  const disabled = busy || !online || !data
  const reviews = new Map(data?.reviews.map(item => [item.job_id, item]))
  const ranked = useMemo(() => (data?.jobs ?? []).map(job => {
    const searchMatches=(data?.searchProfiles??[]).filter(p=>p.enabled).map(p=>scoreSearch(job,p))
    const match=matchJob(job, workspace?.profile ?? null)
    if(searchMatches.length)match.score=Math.max(...searchMatches.map(m=>m.score))
    return {job,match,searchMatches}
  }), [data?.jobs,data?.searchProfiles,workspace?.profile])
  const visible = ranked.filter(({ job }) => {
    const review = reviews.get(job.id)
    return (!query || `${job.title ?? ''} ${job.company ?? ''} ${job.location ?? ''} ${job.description}`.toLowerCase().includes(query.toLowerCase()))
      && (disposition === 'all' || (disposition === 'active' ? review?.disposition !== 'dismissed' : (review?.disposition ?? 'new') === disposition))
      && (!sourceId || data?.origins.some(origin => origin.job_id === job.id && origin.source_id === sourceId))
      && (!mode || (job.work_mode ?? 'unknown') === mode)
      && (!reviewOnly || (job.uncertainty.length > 0 && !review?.reviewed))
  }).sort((a, b) => sort === 'match' ? b.match.score - a.match.score || b.job.created_at.localeCompare(a.job.created_at) : b.job.created_at.localeCompare(a.job.created_at))
  async function addManual(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      const result = await discoveryAction<{ added: boolean }>(client, { action: 'manual', ...entry })
      setEntry(emptyEntry)
      return result.added ? 'Manual job added.' : 'This job already exists; its source was retained.'
    })
  }
  async function reviewJob(job: Job, next: Review['disposition'], reviewed: boolean) {
    await run(async () => { await saveReview(client, ownerId, job.id, next, reviewed); return 'Job review saved.' })
  }
  return <>
    <DiscoveryStatus />
    <div className="action-row discovery-toolbar"><button className="button button-secondary" disabled={busy || loading || !online} onClick={() => void refresh()}>Refresh jobs & status</button><Link className="text-link" to="/settings">Manage sources</Link></div>
    <details className="panel settings-section"><summary>Import from your sources</summary><p>Request a check here, or enable hourly discovery in Automation settings. Partial imports resume on later checks.</p><SourceList />{data && !data.sources.some(source => source.kind !== 'manual') && <p>No import sources configured. <Link to="/settings">Connect a source in Settings</Link> or add a job below.</p>}</details>
    <details className="panel settings-section"><summary>Add a job manually</summary>
      <p>Paste a URL, a description, or both. JobPilot does not browse or submit to the linked site. Add only details you can confirm.</p>
      <form onSubmit={event => void addManual(event)}>
        <div className="field"><label htmlFor="job-url">Original job URL</label><input id="job-url" type="url" maxLength={2048} value={entry.url} disabled={disabled} onChange={event => setEntry({ ...entry, url: event.target.value })} /></div>
        <div className="field"><label htmlFor="job-description">Pasted description</label><textarea id="job-description" rows={6} maxLength={50000} value={entry.description} disabled={disabled} onChange={event => setEntry({ ...entry, description: event.target.value })} /></div>
        <div className="form-grid">{(['title', 'company', 'location'] as const).map(field => <div className="field" key={field}><label htmlFor={`job-${field}`}>{field === 'title' ? 'Job title' : field === 'company' ? 'Company' : 'Location'} (optional)</label><input id={`job-${field}`} value={entry[field]} maxLength={500} disabled={disabled} onChange={event => setEntry({ ...entry, [field]: event.target.value })} /></div>)}
          <div className="field"><label htmlFor="job-mode">Work mode (optional)</label><select id="job-mode" value={entry.work_mode} disabled={disabled} onChange={event => setEntry({ ...entry, work_mode: event.target.value })}><option value="">Unknown</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="on-site">On-site</option></select></div>
        </div>
        <p className="fine-print">Drafts stay in memory on this page. Copy unsaved text before leaving or reloading.</p>
        <button className="button" disabled={disabled || (!entry.url.trim() && !entry.description.trim())}>Add job</button>
      </form>
    </details>
    <section aria-label="Job filters" className="job-filters">
      <div className="field"><label htmlFor="job-search">Search jobs</label><input id="job-search" type="search" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <details><summary>Filter and sort</summary>
      <div className="form-grid">
        <div className="field"><label htmlFor="job-state">Review state</label><select id="job-state" value={disposition} onChange={event => setDisposition(event.target.value)}><option value="active">New & saved</option><option value="new">New</option><option value="saved">Saved</option><option value="dismissed">Dismissed</option><option value="all">All</option></select></div>
        <div className="field"><label htmlFor="job-source">Source</label><select id="job-source" value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">All sources</option>{data?.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div>
        <div className="field"><label htmlFor="work-mode-filter">Work mode</label><select id="work-mode-filter" value={mode} onChange={event => setMode(event.target.value)}><option value="">Any work mode</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="on-site">On-site</option><option value="unknown">Unknown</option></select></div>
        <div className="field"><label htmlFor="job-sort">Sort by</label><select id="job-sort" value={sort} onChange={event => setSort(event.target.value)}><option value="match">Preference score</option><option value="newest">Recently imported</option></select></div>
      </div>
      <div className="choice-list"><label><input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)} />Needs review only</label></div>
      </details>
    </section>
    <details><summary>How scoring works</summary><p className="fine-print">Enabled search profiles use title 35, required keywords up to 25, location 15, work mode 15, and employment type 10 points. Excluded keywords subtract 40 each; excessive experience subtracts 30. Scores are clamped to 0 to 100. Salary is explained separately. Without an enabled search profile, the original saved-profile score uses skills 50, title 25, work mode 15 and location 10. Unknowns earn no points. Eligibility and availability are not confirmed. {workspace?.profile ? '' : 'Save a profile to rank against your preferences.'}</p></details>
    {data && <p className="results-count" role="status">{visible.length} of {data.jobs.length} loaded jobs shown{data.more ? ' · More jobs available below' : ''}</p>}
    {data && !visible.length && <section className="panel empty-state"><h2>{data.jobs.length ? 'No jobs match these filters.' : 'Your opportunities start here.'}</h2><p>{data.jobs.length ? 'Try another filter or search term.' : 'Add a job manually or import from a configured source. Ambiguous alerts will be marked for review.'}</p></section>}
    <div className="job-list">{visible.map(({ job, match, searchMatches }) => {
      const review = reviews.get(job.id), state = review?.disposition ?? 'new'
      const origins = data?.origins.filter(origin => origin.job_id === job.id) ?? []
      const duplicateIds = duplicateSuggestions(job, data?.jobs ?? []).filter(id => {
        const otherSources = data?.origins.filter(origin => origin.job_id === id).map(origin => origin.source_id) ?? []
        return otherSources.some(id => !origins.some(origin => origin.source_id === id))
      })
      const url = canonicalUrl(job.canonical_url)
      return <article className="panel job-item" key={job.id} id={`job-${job.id}`}>
        <div className="resume-title"><h2>{job.title ?? 'Alert awaiting review'}</h2><span className="badge">{state}</span><span className="badge">{match.score}/100 preference score</span></div>
        <p>{job.company ?? 'Company unknown'} · {job.location ?? 'Location unknown'} · {job.work_mode ?? 'Work mode unknown'}</p>
        <p>{job.employment_type??'Employment type unknown'} · {job.experience_years==null?'Experience requirement unknown':`${job.experience_years} years required`} · {job.salary_min==null?'Salary unknown':`${job.salary_currency??'Currency unknown'} ${job.salary_min} / ${job.salary_period??'period unknown'}`}</p>
        {origins.some(o=>o.parsing_confidence==='low') && <p className="notice">Low-confidence alert extraction — review the original email.</p>}
        {searchMatches.length>0 && <details><summary>Search profile matches</summary><p>Best enabled profile determines the displayed score. Unknown data earns no points; scores do not confirm eligibility.</p>{searchMatches.map(m=><div key={m.profile_id}><h3>{m.profile_name}: {m.score}/100</h3><ul>{m.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div>)}</details>}
        <p className="fine-print">Source: {[...new Set(origins.map(origin => data?.sources.find(source => source.id === origin.source_id)?.name ?? 'Unknown'))].join(', ') || 'Unknown'} · {review?.reviewed ? 'Reviewed' : job.uncertainty.length ? 'Needs review' : 'No extraction warnings'}</p>
        <p className="fine-print">Imported {displayDate(job.created_at)} · Source date {job.published_at || origins[0]?.source_date ? displayDate(job.published_at ?? origins[0]?.source_date) : 'unknown'}</p>
        <dl className="job-fit"><div><dt>Matched skills</dt><dd>{match.matched.join(', ') || 'None confirmed'}</dd></div><div><dt>Requirements missing from saved profile</dt><dd>{match.missing.join(', ') || (job.requirements.length ? 'None among extracted skills' : 'Requirements unknown')}</dd></div><div><dt>Title fit</dt><dd>{match.title}</dd></div><div><dt>Location fit</dt><dd>{match.location}</dd></div><div><dt>Work-mode fit</dt><dd>{match.mode}</dd></div></dl>
        <p className="fine-print">A missing skill means it is absent from your saved profile, not that you lack it. Scores do not confirm eligibility.</p>
        {url && <a className="text-link" href={url} target="_blank" rel="noopener noreferrer">Open original job</a>}
        <details><summary>{review?.reviewed ? 'Reviewed — uncertainties retained' : 'Uncertainty & review notes'}</summary><ul>{job.uncertainty.map((note, index) => <li key={index}>{note}</li>)}</ul><button className="button button-secondary" disabled={disabled} onClick={() => void reviewJob(job, state, !review?.reviewed)}>{review?.reviewed ? 'Mark as needing review' : 'Mark reviewed'}</button></details>
        {!!duplicateIds.length && <p className="notice">Possible duplicate from another source: {duplicateIds.length} loaded jobs have the same title, company, and location. Records have not been merged. Search the title with All review states to compare.</p>}
        <details><summary>Description & source history</summary><p className="job-description">{job.description || 'No description available. Read the original source.'}</p><ul>{origins.map(origin => {
          const sourceUrl = canonicalUrl(origin.source_url)
          return <li key={origin.id}><strong>{data?.sources.find(source => source.id === origin.source_id)?.name ?? 'Source unavailable'}</strong><p>{origin.provider??'Original provider unknown'} · Parsing confidence: {origin.parsing_confidence??'Not recorded'}</p><p>{origin.sender ? `Sender: ${origin.sender} · ` : ''}Source date: {origin.source_date ? displayDate(origin.source_date) : 'unknown'}</p>{origin.message_id && <p>Message ID: {origin.message_id}</p>}{sourceUrl && <a className="text-link" href={origin.source_url!} target="_blank" rel="noopener noreferrer">Open source</a>}{canonicalUrl(origin.direct_url) && <a className="text-link" href={canonicalUrl(origin.direct_url)!} target="_blank" rel="noopener noreferrer">Open discovered job</a>}</li>
        })}</ul></details>
        <div className="action-row"><button className="button button-secondary" disabled={disabled} onClick={() => void reviewJob(job, state === 'saved' ? 'new' : 'saved', review?.reviewed ?? false)}>{state === 'saved' ? 'Unsave job' : 'Save job'}</button><button className="button button-secondary" disabled={disabled} onClick={() => void reviewJob(job, state === 'dismissed' ? 'new' : 'dismissed', review?.reviewed ?? false)}>{state === 'dismissed' ? 'Restore job' : 'Dismiss job'}</button>
          {(state === 'saved' || review?.reviewed) && state !== 'dismissed' && <button className="button" disabled={disabled} onClick={() => void run(async () => {
            const application = await applicationAction(client,{ action: 'application_create', jobId: job.id })
            navigate(`/applications?application=${application.id}`)
            return 'Application draft opened. Enter and verify the employer recipient.'
          })}>Create application draft</button>}
        </div>
      </article>
    })}</div>
    {data?.more && <button className="button button-secondary" disabled={loading || busy || !online} onClick={loadMore}>Load 100 more jobs</button>}
  </>
}
