import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { employmentTypes, profileLimits, validateProfile, workModes, type ProfileDraft, type ProfileErrors } from '../lib/profile'
import { loadWorkspace, saveProfile, workspaceMessage } from '../lib/workspace'
import { OwnerContent } from './WorkspaceContext'
import { useWorkspace } from './useWorkspace'

export function ProfilePage() {
  return <><header className="page-heading"><h1>Profile</h1><p>Your details, experience, and job preferences. Nothing is inferred from your resume.</p><Link className="text-link" to="/settings">Back to settings</Link></header>
    <OwnerContent><ProfileForm /></OwnerContent></>
}
function ProfileForm() {
  const { client, ownerId, data, draft, setDraft, dirty, online, acceptProfile, profileBusy: busy, setProfileBusy: setBusy } = useWorkspace()
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const submitting = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const update = (key: keyof ProfileDraft, value: string | string[]) => { setDraft(previous => ({ ...previous, [key]: value })); setNotice('') }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || busy || !online) return
    const nextErrors = validateProfile(draft)
    setErrors(nextErrors); setError(null); setNotice('')
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    submitting.current = true; setBusy(true)
    try { acceptProfile(await saveProfile(client, ownerId, draft)); setNotice('Profile saved.') }
    catch (reason) { setError(workspaceMessage(reason)) }
    finally { submitting.current = false; setBusy(false) }
  }
  async function reload() {
    if (submitting.current || busy || !online || (dirty && !window.confirm('Discard unsaved profile changes and reload your saved profile?'))) return
    submitting.current = true; setBusy(true); setError(null); setNotice('')
    try {
      const saved = await loadWorkspace(client)
      if (!saved.owner) throw new Error()
      acceptProfile(saved.profile); setNotice('Saved profile reloaded.')
    } catch (reason) { setError(workspaceMessage(reason)) }
    finally { submitting.current = false; setBusy(false) }
  }
  function field(key: Exclude<keyof ProfileDraft, 'work_modes' | 'employment_types' | 'salary_period'>, label: string, options: { multiline?: boolean; type?: string; hint?: string; required?: boolean; autoComplete?: string } = {}) {
    const props = { id: key, name: key, value: draft[key], disabled: busy, required: options.required,
      autoComplete: options.autoComplete ?? 'off', 'aria-invalid': !!errors[key], 'aria-describedby': `${key}-hint ${errors[key] ? `${key}-error` : ''}`,
      maxLength: profileLimits[key as keyof typeof profileLimits], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, key === 'salary_currency' ? event.target.value.toUpperCase() : event.target.value) }
    return <div className="field" key={key}><label htmlFor={key}>{label}{options.required ? ' (required)' : ''}</label>
      {options.multiline ? <textarea {...props} rows={key === 'experience' || key === 'projects' ? 6 : 4} /> : <input {...props} type={options.type ?? 'text'} inputMode={key.startsWith('salary_') && key !== 'salary_currency' ? 'decimal' : undefined} spellCheck={options.type === 'email' || options.type === 'url' ? false : undefined} />}
      <span className="fine-print" id={`${key}-hint`}>{options.hint ?? (options.required ? '' : 'Optional')}</span>
      {errors[key] && <p className="field-error" id={`${key}-error`}>{errors[key]}</p>}
    </div>
  }
  function choices(key: 'work_modes' | 'employment_types', label: string, values: readonly string[]) {
    return <fieldset className="choices"><legend>{label}</legend><p className="fine-print">Leave all unchecked for unknown / unset.</p>
      <div className="choice-list">{values.map(value => <label key={value}><input type="checkbox" name={key} value={value} disabled={busy} checked={draft[key].includes(value)}
        onChange={event => update(key, event.target.checked ? [...draft[key], value] : draft[key].filter(item => item !== value))} />{value}</label>)}</div>
    </fieldset>
  }
  return <form onSubmit={save} noValidate ref={formRef} aria-busy={busy}>
    {!data?.profile && <p className="notice">No saved profile yet. Only your name and contact email are required. Blank preferences stay unknown.</p>}
    <fieldset className="panel form-section" disabled={busy}><legend>Contact details</legend><div className="form-grid">
      {field('full_name', 'Full name', { required: true, autoComplete: 'name' })}{field('contact_email', 'Contact email', { required: true, type: 'email', autoComplete: 'email' })}
      {field('phone', 'Phone number', { type: 'tel', autoComplete: 'tel' })}{field('location', 'City / location', { autoComplete: 'address-level2' })}
      {field('github_url', 'GitHub URL', { type: 'url' })}{field('portfolio_url', 'Portfolio URL', { type: 'url' })}
    </div></fieldset>
    <fieldset className="panel form-section" disabled={busy}><legend>Professional background</legend>
      {field('summary', 'Professional summary', { multiline: true })}
      {field('skills', 'Skills', { multiline: true, hint: 'One skill per line. Add only skills you choose to claim.' })}
      {field('experience', 'Experience', { multiline: true, hint: 'Roles, employers, dates, and accomplishments in your own words.' })}
      {field('projects', 'Projects', { multiline: true, hint: 'Project names, links, dates, and your contributions.' })}
    </fieldset>
    <fieldset className="panel form-section" disabled={busy}><legend>Job preferences</legend><div className="form-grid">
      {field('target_titles', 'Target job titles', { multiline: true, hint: 'One title per line. Blank means unknown / unset.' })}
      {field('preferred_locations', 'Preferred locations', { multiline: true, hint: 'One location per line. Blank means unknown / unset.' })}
    </div>{choices('work_modes', 'Work arrangements', workModes)}{choices('employment_types', 'Employment types', employmentTypes)}
      <h2>Optional salary range</h2><p className="fine-print">Leave blank if you have not chosen a range. A range needs a currency and pay period.</p>
      <div className="form-grid">{field('salary_min', 'Minimum salary')}{field('salary_max', 'Maximum salary')}{field('salary_currency', 'Currency', { hint: 'Three-letter code, such as USD, EUR, or PHP.' })}
        <div className="field"><label htmlFor="salary_period">Pay period</label><select id="salary_period" name="salary_period" value={draft.salary_period} onChange={event => update('salary_period', event.target.value)} aria-invalid={!!errors.salary_period} aria-describedby="salary_period-error">
          <option value="">Unknown / unset</option><option value="hour">Per hour</option><option value="month">Per month</option><option value="year">Per year</option>
        </select><p className="field-error" id="salary_period-error">{errors.salary_period}</p></div>
      </div>{field('availability', 'Availability', { multiline: true, hint: 'Your notice period, earliest start date, or other availability details. Blank means unknown.' })}
    </fieldset>
    <div className="form-actions"><p role="status">{busy ? 'Please wait…' : dirty ? 'Unsaved changes' : notice || (data?.profile ? 'All changes saved' : 'Not saved yet')}</p>
      <p className="fine-print">Drafts stay in memory while navigating. Save before closing or signing out.</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {Object.keys(errors).length > 0 && <p className="field-error" role="alert">Check the highlighted fields before saving.</p>}
      <div className="action-row"><button type="submit" className="button" disabled={busy || !online}>{busy ? 'Saving / loading…' : 'Save profile'}</button>
        <button type="button" className="button button-secondary" disabled={busy || !online} onClick={() => void reload()}>Reload saved profile</button></div>
    </div>
  </form>
}
