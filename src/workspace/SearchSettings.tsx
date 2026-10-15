import { useState, type FormEvent } from 'react'
import { emptySearchProfile, employmentTypes, validSearchProfile, type SearchProfile } from '../../supabase/functions/_shared/search'
import { discoveryAction } from '../lib/discovery'
import { useWorkspace } from './useWorkspace'
import { useDiscovery } from './useDiscovery'

const listFields = { desired_titles:'Desired job titles', alternative_titles:'Alternative titles', required_keywords:'Required keywords', excluded_keywords:'Excluded keywords', locations:'Preferred Philippine locations' } as const
export function SearchSettings() {
  const {client}=useWorkspace(), {data,busy,online,run}=useDiscovery()
  const [profile,setProfile]=useState<SearchProfile>(emptySearchProfile)
  const [lists,setLists]=useState<Record<string,string>>({})
  const [error,setError]=useState('')
  const disabled=busy || !online || !data
  const edit=(p:SearchProfile)=>{setProfile(p);setLists(Object.fromEntries(Object.keys(listFields).map(k=>[k,p[k as keyof typeof listFields].join(', ')])));setError('')}
  async function save(event:FormEvent) {
    event.preventDefault()
    const value={...profile,...Object.fromEntries(Object.keys(listFields).map(k=>[k,(lists[k]??'').split(',').map(v=>v.trim()).filter(Boolean)]))}
    if (!validSearchProfile(value)) {setError('Enter a name and at least one title. Lists allow 20 entries of up to 100 characters; results must be 1–50.');return}
    if (await run(async()=>{await discoveryAction(client,{action:'save_search_profile',profile:value});return 'Search profile saved.'})) edit(emptySearchProfile())
  }
  return <section className="panel settings-section" aria-labelledby="search-profiles-heading">
    <h2 id="search-profiles-heading">Search profiles</h2>
    <p>Enabled profiles guide discovery and explain job matches. New profiles start disabled. Salary preferences use PHP per month; unknown details remain unknown.</p>
    <ul className="source-list">{data?.searchProfiles?.map(p=><li key={p.id}><h3>{p.name}</h3><p>{p.enabled?'Enabled':'Disabled'} · {p.desired_titles.join(', ')} · Up to {p.results_limit} results per source</p><div className="action-row"><button className="button button-secondary" disabled={disabled} aria-label={`Edit ${p.name}`} onClick={()=>edit(p)}>Edit<span className="sr-only"> {p.name}</span></button><button className="button button-secondary" disabled={disabled} aria-label={`${p.enabled?'Disable':'Enable'} ${p.name}`} onClick={()=>void run(async()=>{await discoveryAction(client,{action:'save_search_profile',profile:{...p,enabled:!p.enabled}});return 'Search profile updated.'})}>{p.enabled?'Disable':'Enable'}<span className="sr-only"> {p.name}</span></button><button className="button button-secondary" disabled={disabled} aria-label={`Remove ${p.name}`} onClick={()=>void run(async()=>{await discoveryAction(client,{action:'delete_search_profile',id:p.id});if(profile.id===p.id)edit(emptySearchProfile());return 'Search profile removed. Imported jobs retained.'})}>Remove<span className="sr-only"> {p.name}</span></button></div></li>)}</ul>
    <details open={!!profile.id}><summary>{profile.id?'Edit search profile':'Add search profile'}</summary>
      <form onSubmit={event=>void save(event)}>
        {error && <p role="alert" className="error-message">{error}</p>}
        <div className="field"><label htmlFor="search-profile-name">Profile name</label><input id="search-profile-name" required maxLength={100} disabled={disabled} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></div>
        <div className="form-grid">{Object.entries(listFields).map(([key,label])=><div className="field" key={key}><label htmlFor={`search-${key}`}>{label} (comma separated)</label><input id={`search-${key}`} required={key==='desired_titles'} maxLength={2018} disabled={disabled} value={lists[key]??''} onChange={e=>setLists({...lists,[key]:e.target.value})}/></div>)}</div>
        <fieldset className="choice-list"><legend>Work arrangements</legend>{['remote','hybrid','on-site'].map(mode=><label key={mode}><input type="checkbox" disabled={disabled} checked={profile.work_modes.includes(mode)} onChange={e=>setProfile({...profile,work_modes:e.target.checked?[...profile.work_modes,mode]:profile.work_modes.filter(v=>v!==mode)})}/>{mode}</label>)}</fieldset>
        <fieldset className="choice-list"><legend>Employment types</legend>{employmentTypes.map(type=><label key={type}><input type="checkbox" disabled={disabled} checked={profile.employment_types.includes(type)} onChange={e=>setProfile({...profile,employment_types:e.target.checked?[...profile.employment_types,type]:profile.employment_types.filter(v=>v!==type)})}/>{type}</label>)}</fieldset>
        <div className="form-grid"><div className="field"><label htmlFor="search-experience">Maximum years of experience (0 for entry-level)</label><input id="search-experience" type="number" min={0} max={50} step={1} disabled={disabled} value={profile.max_experience??''} onChange={e=>setProfile({...profile,max_experience:e.target.value===''?null:Number(e.target.value)})}/></div>
        <div className="field"><label htmlFor="search-salary">Minimum salary (PHP per month, optional)</label><input id="search-salary" type="number" min={0} max={10000000} disabled={disabled} value={profile.minimum_salary??''} onChange={e=>setProfile({...profile,minimum_salary:e.target.value===''?null:Number(e.target.value)})}/></div>
        <div className="field"><label htmlFor="search-limit">Results per source per check</label><input id="search-limit" type="number" required min={1} max={50} disabled={disabled} value={profile.results_limit} onChange={e=>setProfile({...profile,results_limit:Number(e.target.value)})}/></div></div>
        <p className="fine-print">If several profiles are enabled, the smallest result limit bounds each source check. Draft edits stay in memory.</p>
        <div className="action-row"><button className="button" disabled={disabled}>Save search profile</button>{profile.id && <button type="button" className="button button-secondary" onClick={()=>edit(emptySearchProfile())}>Cancel editing</button>}</div>
      </form>
    </details>
  </section>
}
