export const workModes = ['remote', 'hybrid', 'on-site'] as const
export const employmentTypes = ['full-time', 'part-time', 'contract', 'temporary', 'internship', 'freelance'] as const

export function emptyProfile() {
  return {
    full_name: '', contact_email: '', phone: '', location: '', github_url: '', portfolio_url: '', summary: '',
    skills: '', experience: '', projects: '', target_titles: '', preferred_locations: '',
    work_modes: [] as string[], employment_types: [] as string[], salary_min: '', salary_max: '',
    salary_currency: '', salary_period: '', availability: '',
  }
}
export type ProfileDraft = ReturnType<typeof emptyProfile>
export type ProfileErrors = Partial<Record<keyof ProfileDraft, string>>
export const profileLimits = { full_name: 150, contact_email: 254, phone: 50, location: 200, github_url: 2048,
  portfolio_url: 2048, summary: 10000, experience: 20000, projects: 20000, availability: 2000 }

export function validateProfile(draft: ProfileDraft): ProfileErrors {
  const errors: ProfileErrors = {}
  for (const [key, limit] of Object.entries(profileLimits)) {
    if ((draft[key as keyof typeof profileLimits]).length > limit) errors[key as keyof ProfileDraft] = `Use ${limit} characters or fewer.`
  }
  if (!draft.full_name.trim()) errors.full_name = 'Enter your full name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contact_email.trim())) errors.contact_email = 'Enter a valid contact email.'
  for (const key of ['github_url', 'portfolio_url'] as const) {
    if (!draft[key].trim()) continue
    try {
      const url = new URL(draft[key].trim())
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error()
    } catch { errors[key] = 'Enter a full https:// or http:// URL without credentials.' }
  }
  for (const key of ['skills', 'target_titles', 'preferred_locations'] as const) {
    const items = lines(draft[key])
    if (items && (items.length > 100 || items.some(item => item.length > 200))) errors[key] = 'Use up to 100 lines, each at most 200 characters.'
  }
  for (const key of ['salary_min', 'salary_max'] as const) {
    if (draft[key] && (!/^\d+(\.\d{1,2})?$/.test(draft[key]) || Number(draft[key]) > 9999999999.99)) errors[key] = 'Enter a non-negative amount with up to two decimal places (maximum 9,999,999,999.99).'
  }
  if (draft.salary_min && draft.salary_max && Number(draft.salary_max) < Number(draft.salary_min)) errors.salary_max = 'Maximum must be at least the minimum.'
  if ((draft.salary_min || draft.salary_max || draft.salary_currency) && !/^[A-Z]{3}$/.test(draft.salary_currency)) errors.salary_currency = 'Enter a three-letter currency code, such as USD.'
  if ((draft.salary_min || draft.salary_max) && !draft.salary_period) errors.salary_period = 'Choose a pay period for this range.'
  if (draft.salary_period && !['hour', 'month', 'year'].includes(draft.salary_period)) errors.salary_period = 'Choose hour, month, or year.'
  if (draft.work_modes.some(value => !workModes.includes(value as typeof workModes[number]))) errors.work_modes = 'Choose one of the listed work arrangements.'
  if (draft.employment_types.some(value => !employmentTypes.includes(value as typeof employmentTypes[number]))) errors.employment_types = 'Choose one of the listed employment types.'
  return errors
}

function lines(value: string) {
  const items = [...new Set(value.split('\n').map(item => item.trim()).filter(Boolean))]
  return items.length ? items : null
}
export function profilePayload(draft: ProfileDraft) {
  const optional = (value: string) => value.trim() || null
  return {
    ...draft, full_name: draft.full_name.trim(), contact_email: draft.contact_email.trim(),
    phone: optional(draft.phone), location: optional(draft.location), github_url: optional(draft.github_url),
    portfolio_url: optional(draft.portfolio_url), summary: optional(draft.summary), experience: optional(draft.experience),
    projects: optional(draft.projects), availability: optional(draft.availability),
    skills: lines(draft.skills), target_titles: lines(draft.target_titles), preferred_locations: lines(draft.preferred_locations),
    work_modes: draft.work_modes.length ? draft.work_modes : null,
    employment_types: draft.employment_types.length ? draft.employment_types : null,
    salary_min: draft.salary_min ? Number(draft.salary_min) : null, salary_max: draft.salary_max ? Number(draft.salary_max) : null,
    salary_currency: optional(draft.salary_currency), salary_period: optional(draft.salary_period),
  }
}
export type Profile = ReturnType<typeof profilePayload> & { owner_id: string; updated_at: string }
export function profileDraft(profile: Profile | null): ProfileDraft {
  const draft = emptyProfile()
  if (!profile) return draft
  for (const key of Object.keys(draft) as (keyof ProfileDraft)[]) {
    if (key === 'work_modes' || key === 'employment_types') draft[key] = profile[key] ?? []
    else if (key === 'skills' || key === 'target_titles' || key === 'preferred_locations') draft[key] = profile[key]?.join('\n') ?? ''
    else draft[key] = String(profile[key] ?? '')
  }
  return draft
}
