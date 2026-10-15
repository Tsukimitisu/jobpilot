export type Candidate = {
  employment_type?: string | null; experience_years?: number | null; salary_min?: number | null; salary_currency?: string | null; salary_period?: string | null
  provider?: string; provider_external_id?: string | null; parsing_confidence?: 'high' | 'medium' | 'low'
  title: string | null; company: string | null; location: string | null; work_mode: string | null
  description: string; canonical_url: string | null; requirements: string[]; uncertainty: string[]; published_at: string | null
}
export type Preferences = { skills: string[] | null; target_titles: string[] | null; preferred_locations: string[] | null; work_modes: string[] | null }

export function canonicalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    // Hash routes can identify different jobs. Remove only known section anchors.
    if (/^#(?:apply|application|description|details|top)$/i.test(url.hash)) url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['gclid', 'fbclid'].includes(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    return url.href
  } catch { return null }
}
export function plainText(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  let text = value.slice(0, 300000)
  for (let i = 0; i < 3; i++) text = text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? whole
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
  })
  return text.replace(/<(script|style|iframe|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]))>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000)
}
const field = (text: string, label: string, limit = 500) => {
  const values = [...text.matchAll(new RegExp(`^${label}:\\s*(.+)$`, 'gmi'))]
  const value = values.length === 1 ? values[0][1].trim() : null
  return value && value.length <= limit ? value : null
}
function candidate(text: string): Candidate {
  const mode = field(text, 'Work mode')?.toLowerCase() ?? null
  const required = field(text, 'Required skills')
  const years=field(text,'(?:Minimum experience|Experience required)')?.match(/^(\d{1,2})\s*years?$/i)
  const salary=field(text,'Salary')?.match(/^PHP\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per month|\/month)$/i)
  const type=field(text,'Employment type')?.toLowerCase()
  return {
    experience_years:years && Number(years[1])<=80?Number(years[1]):null,
    employment_type:type && ['full-time','part-time','contract','temporary','internship','permanent'].includes(type)?type:null,
    salary_min:salary?Number(salary[1].replaceAll(',','')):null,salary_currency:salary?'PHP':null,salary_period:salary?'month':null,
    title: field(text, '(?:Job title|Title)'), company: field(text, 'Company'), location: field(text, 'Location'),
    work_mode: mode && ['remote', 'hybrid', 'on-site'].includes(mode) ? mode : null,
    description: text, canonical_url: canonicalUrl(field(text, '(?:Job URL|URL)', 2048)),
    requirements: required ? [...new Set(required.split(',').map(item => item.trim()).filter(Boolean))].slice(0, 100) : [],
    uncertainty: [], published_at: null,
  }
}
function unknowns(job: Candidate): Candidate {
  for (const key of ['title', 'company', 'location', 'work_mode', 'canonical_url'] as const) if (!job[key]) job.uncertainty.push(`${key.replaceAll('_', ' ')} unknown`)
  if (!job.requirements.length) job.uncertainty.push('Requirements not reliably extracted; read the original description.')
  job.uncertainty.push('Salary, eligibility, and application address are not verified.')
  return job
}
export function parseAlert(body: string): Candidate[] {
  const text = plainText(body)
  const blocks = text.split(/\n(?=(?:Job title|Title):)/i).filter(Boolean)
  const parsed = blocks.map(candidate)
  if (body.length <= 50000 && parsed.length && parsed.every(job => job.title && job.company && job.canonical_url) && new Set(parsed.map(job => job.canonical_url)).size === parsed.length) {
    return parsed.map(job => unknowns({ ...job, uncertainty: ['Extracted from explicit alert fields; not independently verified.'] }))
  }
  return [unknowns({ title: null, company: null, location: null, work_mode: null, canonical_url: null, requirements: [],
    published_at: null, description: text, uncertainty: [body.length > 50000 ? 'Alert exceeds the extraction limit; read the original for the full message.' : 'Alert needs review: individual jobs could not be reliably identified.'] })]
}
export function manualCandidate(input: { url?: string; description?: string; title?: string; company?: string; location?: string; work_mode?: string }): Candidate {
  const text = plainText(input.description ?? '')
  const job = candidate(text)
  for (const key of ['title', 'company', 'location'] as const) job[key] = plainText(input[key] ?? '').slice(0, 500) || job[key]
  if (input.work_mode && ['remote', 'hybrid', 'on-site'].includes(input.work_mode)) job.work_mode = input.work_mode
  job.canonical_url = canonicalUrl(input.url) ?? job.canonical_url
  return unknowns(job)
}
export function validDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
export function greenhouseCandidate(job: { title?: string; content?: string; absolute_url?: string; location?: { name?: string }; updated_at?: string }, company: string | null): Candidate {
  const result = candidate(plainText(job.content ?? ''))
  result.title = plainText(job.title ?? '').slice(0, 500) || null
  result.company = company
  result.location = plainText(job.location?.name ?? '').slice(0, 500) || null
  result.canonical_url = canonicalUrl(job.absolute_url)
  result.published_at = validDate(job.updated_at)
  result.uncertainty.push('Source date is the board update time, not necessarily the posting date.')
  if ((job.content?.length ?? 0) > 50000) result.uncertainty.push('Description may be truncated; read the original listing.')
  return unknowns(result)
}
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
export function matchJob(job: Candidate, profile: Preferences | null) {
  const skills = new Set((profile?.skills ?? []).map(normalized))
  const matched = job.requirements.filter(value => skills.has(normalized(value)))
  const missing = job.requirements.filter(value => !skills.has(normalized(value)))
  const fit = (value: string | null, preferences: string[] | null | undefined) => !value ? 'Unknown' : !preferences?.length ? 'No preference saved' : preferences.some(item => normalized(item) === normalized(value)) ? 'Matches preference' : 'Does not match preference'
  const title = fit(job.title, profile?.target_titles)
  const location = fit(job.location, profile?.preferred_locations)
  const mode = fit(job.work_mode, profile?.work_modes)
  const score = Math.round((job.requirements.length ? matched.length / job.requirements.length * 50 : 0)
    + (title === 'Matches preference' ? 25 : 0) + (mode === 'Matches preference' ? 15 : 0) + (location === 'Matches preference' ? 10 : 0))
  return { score, matched, missing, title, location, mode }
}
export function duplicateSuggestions<T extends Candidate & { id: string }>(job: T, jobs: T[]) {
  if (!job.title || !job.company || !job.location) return []
  return jobs.filter(other => other.id !== job.id && ['title', 'company', 'location'].every(key => {
    const field = key as 'title' | 'company' | 'location'
    return other[field] && normalized(other[field]!) === normalized(job[field]!)
  })).map(other => other.id)
}
