import { canonicalUrl, greenhouseCandidate, manualCandidate, plainText, validDate, type Candidate } from './discovery.ts'
import { fetchJson, ServiceError } from './google.ts'
import type { SearchProfile } from './search.ts'

export type AdzunaConfig = { appId: string; appKey: string }
export type ConnectorSource = { kind: string; source_key: string; name: string; cursor: string | null }
export type ConnectorPage = { jobs: { external: string; job: Candidate; checkpoint?: string | null }[]; cursor: string | null; company: string | null }
export class ProviderError extends ServiceError {
  constructor(code: string, public retryAt: string | null = null) { super(code) }
}
export function retryAfter(value: string | null, now = Date.now()): string | null {
  if (!value) return null
  const date = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value)
  return Number.isFinite(date) && date > now && date < 8640000000000000 ? new Date(date).toISOString() : null
}
// Intercept status before JSON decoding: providers commonly return HTML on 429/503.
export function discoveryTransport(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    let response: Response
    try { response = await transport(input, init) } catch (error) {
      if (error instanceof ServiceError) throw error
      throw new ProviderError('provider_unavailable')
    }
    if (response.status === 429 || response.status === 503) {
      const until = retryAfter(response.headers.get('Retry-After'))
      await response.body?.cancel()
      throw new ProviderError(response.status === 429 ? 'rate_limited' : 'provider_unavailable', until)
    }
    return response
  }
}
const text = (value: unknown) => typeof value === 'string' ? plainText(value).slice(0, 500) || null : null
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const items = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value) || value.some(v => !v || typeof v !== 'object')) throw new ServiceError('provider_unavailable')
  return value
}
const employment = (value: unknown) => ({ fulltime: 'full-time', parttime: 'part-time', contract: 'contract', temporary: 'temporary', intern: 'internship', internship: 'internship', permanent: 'permanent' }[String(value).toLowerCase().replace(/[- ]/g, '')] ?? null)
function atsJob(raw: Record<string, unknown>, source: ConnectorSource): Candidate {
  const lever = source.kind === 'lever', categories = record(raw.categories)
  const description=[raw.descriptionPlain ?? raw.description,...(lever && Array.isArray(raw.lists)?raw.lists.slice(0,30).map(v=>{const section=record(v);return `${text(section.text)??''}\n${typeof section.content==='string'?section.content:''}`}):[]),lever?raw.additionalPlain:null].filter(v=>typeof v==='string').join('\n')
  const job = manualCandidate({ title: text(lever ? raw.text : raw.title) ?? '', description,
    location: text(lever ? categories.location : raw.location) ?? '', url: canonicalUrl(lever ? raw.hostedUrl : raw.jobUrl) ?? '' })
  // These APIs do not expose a verified company name; board identity stays in attribution.
  job.company = null
  job.work_mode = ({ remote: 'remote', hybrid: 'hybrid', onsite: 'on-site', 'on-site': 'on-site' }[String(raw.workplaceType).toLowerCase()] ?? (raw.isRemote === true ? 'remote' : null))
  job.employment_type = employment(lever ? categories.commitment : raw.employmentType)
  job.published_at = validDate(lever ? raw.createdAt : raw.publishedAt)
  job.parsing_confidence = 'high'
  return job
}

// Adzuna's documented country list has no Philippine market. Require an explicit supported market.
export const adzunaMarkets = ['gb','us','au','at','br','ca','de','fr','in','it','nl','nz','pl','sg','za']
export async function connectorPage(source: ConnectorSource, limit: number, profiles: SearchProfile[], credentials: AdzunaConfig | undefined, transport: typeof fetch): Promise<ConnectorPage> {
  const get = async (url: string) => {
    try { return await fetchJson(url, {}, discoveryTransport(transport)) }
    catch (error) { if (error instanceof ServiceError && error.code==='reconnect_required') throw new ServiceError('provider_unavailable'); throw error }
  }
  const key = source.source_key
  if (source.kind !== 'adzuna' && !/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new ServiceError('invalid_source')
  if (source.kind === 'greenhouse') {
    const base = `https://boards-api.greenhouse.io/v1/boards/${key}`
    const board = await get(base), page = await get(`${base}/jobs?content=true`)
    const company = text(board.name)
    const remaining = items(page.jobs).filter(j => Number.isSafeInteger(j.id) && (!source.cursor || Number(j.id) > Number(source.cursor))).sort((a,b) => Number(a.id)-Number(b.id))
    const batch = remaining.slice(0,limit)
    return { company, cursor: remaining.length > batch.length ? String(batch.at(-1)!.id) : null,
      jobs: batch.map(j => ({ external: String(j.id), job: greenhouseCandidate(j,company),checkpoint:String(j.id) })) }
  }
  if (source.kind === 'lever') {
    const offset = Number(source.cursor ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new ServiceError('invalid_cursor')
    const page = items(await get(`https://api.lever.co/v0/postings/${key}?mode=json&skip=${offset}&limit=${limit}`))
    return { company: null, cursor: page.length >= limit && offset+limit <= 100000 ? String(offset+limit) : null,
      jobs: page.slice(0,limit).map((j,i) => ({ external: typeof j.id==='string'?j.id:'', job: atsJob(j,source),checkpoint:String(offset+i+1) })).filter(j=>j.external) }
  }
  if (source.kind === 'ashby') {
    const page = await get(`https://api.ashbyhq.com/posting-api/job-board/${key}`)
    const jobs = items(page.jobs).filter(j => j.isListed === true && canonicalUrl(j.jobUrl)).sort((a,b) => String(a.jobUrl).localeCompare(String(b.jobUrl)))
    const remaining = jobs.filter(j => !source.cursor || String(j.jobUrl).localeCompare(source.cursor) > 0), batch = remaining.slice(0,limit)
    return { company: null, cursor: remaining.length > batch.length ? String(batch.at(-1)!.jobUrl) : null,
      jobs: batch.map(j => ({ external: canonicalUrl(j.jobUrl)!, job: atsJob(j,source),checkpoint:String(j.jobUrl) })) }
  }
  if (source.kind !== 'adzuna' || !adzunaMarkets.includes(key)) throw new ServiceError('invalid_source')
  if (!credentials?.appId || !credentials.appKey) throw new ServiceError('not_configured')
  const enabled = profiles.filter(p => p.enabled).sort((a,b) => (a.id ?? '').localeCompare(b.id ?? ''))
  if (!enabled.length) throw new ServiceError('no_search_profiles')
  const revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(enabled))))).map(v=>v.toString(16).padStart(2,'0')).join('')
  let cursor: { profile: number; title: number; page: number; revision: string; offset?:number } = { profile: 0, title: 0, page: 1, revision }
  if (source.cursor) {
    try { const c = JSON.parse(source.cursor); if (c.revision === cursor.revision && [c.profile,c.title,c.page].every(Number.isInteger) && c.profile >= 0 && c.title >= 0 && c.page >= 1 && c.page <= 3) cursor = c } catch { /* Restart after an obsolete cursor. */ }
  }
  const p = enabled[cursor.profile] ?? enabled[0], titles = [...p.desired_titles,...p.alternative_titles]
  const size = Math.min(limit,p.results_limit)
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${key}/search/${cursor.page}`)
  url.search = new URLSearchParams({ app_id: credentials.appId, app_key: credentials.appKey, results_per_page: String(size), what: `${titles[cursor.title] ?? titles[0]} ${p.required_keywords.join(' ')}`.trim(), what_exclude: p.excluded_keywords.join(' '), 'content-type': 'application/json' }).toString()
  // Do not send PH locations or PHP/month salary as foreign-market filters.
  const page = await get(url.href), results = items(page.results)
  const next = { ...cursor,offset:0 }
  if (results.length >= size && cursor.page < 3) next.page++
  else { next.page=1; next.title++; if (next.title >= titles.length) { next.title=0; next.profile++ } }
  return { company: 'Adzuna', cursor: next.profile < enabled.length ? JSON.stringify(next) : null,
    jobs: results.slice(0,size).map((j,index) => {
      const job = manualCandidate({ title: text(j.title) ?? '', company: text(record(j.company).display_name) ?? '', location: text(record(j.location).display_name) ?? '', description: typeof j.description === 'string' ? j.description : '', url: canonicalUrl(j.redirect_url) ?? '' })
      job.employment_type = employment(j.contract_time ?? j.contract_type)
      job.published_at=validDate(j.created)
      job.uncertainty.push('Adzuna supplies a description snippet. Eligibility for Philippine applicants is unknown. Salary estimates are not imported.')
      job.provider_external_id = `${key}:${j.id}`
      return { external: typeof j.id==='string' || typeof j.id==='number'?String(j.id):'', job,checkpoint:JSON.stringify({...cursor,offset:index+1}) }
    }).filter((j,index)=>index>=(cursor.offset??0) && j.external) }
}
