import type { Candidate } from './discovery.ts'

export type SearchProfile = {
  id?: string; name: string; desired_titles: string[]; alternative_titles: string[]
  required_keywords: string[]; excluded_keywords: string[]; locations: string[]
  work_modes: string[]; employment_types: string[]; max_experience: number | null
  minimum_salary: number | null; results_limit: number; enabled: boolean
}
export const emptySearchProfile = (): SearchProfile => ({ name: '', desired_titles: [], alternative_titles: [], required_keywords: [], excluded_keywords: [], locations: [], work_modes: [], employment_types: [], max_experience: null, minimum_salary: null, results_limit: 20, enabled: false })
export const employmentTypes = ['full-time', 'part-time', 'contract', 'temporary', 'internship', 'permanent']
const lists = ['desired_titles', 'alternative_titles', 'required_keywords', 'excluded_keywords', 'locations', 'work_modes', 'employment_types'] as const
export function validSearchProfile(value: unknown): value is SearchProfile {
  if (!value || typeof value !== 'object') return false
  const p = value as SearchProfile
  return typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 100
    && lists.every(key => Array.isArray(p[key]) && p[key].length <= 20 && p[key].every(v => typeof v === 'string' && v.trim().length > 0 && v.length <= 100))
    && p.desired_titles.length > 0 && p.work_modes.every(v => ['remote', 'hybrid', 'on-site'].includes(v))
    && p.employment_types.every(v => employmentTypes.includes(v)) && typeof p.enabled === 'boolean'
    && Number.isInteger(p.results_limit) && p.results_limit >= 1 && p.results_limit <= 50
    && (p.max_experience === null || Number.isInteger(p.max_experience) && p.max_experience >= 0 && p.max_experience <= 50)
    && (p.minimum_salary === null || Number.isFinite(p.minimum_salary) && p.minimum_salary >= 0 && p.minimum_salary <= 10000000)
}
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
const contains = (text: string, phrase: string) => (` ${normalize(text)} `).includes(` ${normalize(phrase)} `)
export type SearchMatch = { profile_id: string; profile_name: string; score: number; reasons: string[] }
export function scoreSearch(job: Candidate, p: SearchProfile): SearchMatch {
  let score = 0
  const reasons: string[] = [], text = `${job.title ?? ''} ${job.description}`.replace(/[.,;:!?()]/g, ' ')
  if ([...p.desired_titles, ...p.alternative_titles].some(v => contains(job.title ?? '', v))) { score += 35; reasons.push('Title matched') }
  for (const keyword of p.required_keywords) {
    if (contains(text, keyword)) { score += 25 / p.required_keywords.length; reasons.push(`Required keyword matched: ${keyword}`) }
    else reasons.push(`Required keyword not confirmed: ${keyword}`)
  }
  if (p.locations.some(v => contains(job.location ?? '', v))) { score += 15; reasons.push('Preferred location matched') }
  if (job.work_mode && p.work_modes.includes(job.work_mode)) { score += 15; reasons.push(job.work_mode === 'remote' ? 'Remote preference matched' : 'Work mode preference matched') }
  if (job.employment_type && p.employment_types.includes(job.employment_type)) { score += 10; reasons.push('Employment type matched') }
  for (const keyword of p.excluded_keywords) if (contains(text, keyword)) { score -= 40; reasons.push(`Excluded keyword found: ${keyword}`) }
  if (p.max_experience !== null && job.experience_years != null && job.experience_years > p.max_experience) { score -= 30; reasons.push('Experience requirement too high') }
  if (!job.location) reasons.push('Location unknown')
  if (!job.work_mode) reasons.push('Work mode unknown')
  if (job.experience_years == null) reasons.push('Experience requirement unknown')
  if (!job.employment_type) reasons.push('Employment type unknown')
  if (job.salary_min == null) reasons.push('Salary unknown')
  else if (p.minimum_salary !== null) {
    if (job.salary_currency === 'PHP' && job.salary_period === 'month') reasons.push(job.salary_min >= p.minimum_salary ? 'Minimum salary matched' : 'Salary below preference')
    else reasons.push('Salary cannot be compared to PHP per month')
  }
  return { profile_id: p.id ?? '', profile_name: p.name, score: Math.max(0, Math.min(100, Math.round(score))), reasons }
}
