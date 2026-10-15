import { canonicalUrl, manualCandidate, parseAlert, plainText, type Candidate } from './discovery.ts'

const domains: [string,string,RegExp][] = [
  ['linkedin.com','LinkedIn',/\/jobs\/view\/(?:[^/?]*-)?(\d+)/],
  ['indeed.com','Indeed',/[?&](?:jk|vjk)=([\w-]+)/],
  ['jobstreet.com','JobStreet',/\/job\/(\d+)/],
  ['jobstreet.com.ph','JobStreet',/\/job\/(\d+)/],
  ['glassdoor.com','Glassdoor',/[?&]jobListingId=(\d+)/],
  ['kalibrr.com','Kalibrr',/\/jobs?\/(\d+)/],
  ['bossjob.ph','Bossjob',/\/job\/([^/?#]+)/],
  ['bossjob.com','Bossjob',/\/job\/([^/?#]+)/],
]
function identity(link: string) {
  const url = new URL(link)
  for (const [domain,provider,pattern] of domains) {
    if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) continue
    const id = `${url.pathname}${url.search}`.match(pattern)?.[1]
    if (id) return { provider, provider_external_id: id }
  }
  return null
}
export function parseJobAlert(body: string, sender: string | null): Candidate[] {
  const explicit = parseAlert(body)
  if (explicit.every(job => job.title && job.company && job.canonical_url)) return explicit.slice(0,50).map(job => ({ ...job,
    ...(identity(job.canonical_url!) ?? { provider: 'Other email alert' }), parsing_confidence: 'high' }))
  const jobs = new Map<string,Candidate>()
  const anchors = [...body.slice(0,300000).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].slice(0,500)
  for (const anchor of anchors) {
    const url=canonicalUrl(plainText(anchor[1]))
    if (!url) continue
    const known=identity(url), title=plainText(anchor[2])
    if (!known || !title || title.length>200 || /^(?:apply|view|see|click|learn|job alert|unsubscribe)\b/i.test(title)) continue
    const job=manualCandidate({ title, url, description: title })
    job.uncertainty.unshift('Email link title only; company, requirements and eligibility need review.')
    jobs.set(url,{ ...job,...known,parsing_confidence:'medium' })
    if (jobs.size>=50) break
  }
  // Plain-text alerts preserve direct recognized URLs, but never guess nearby company/title fields.
  if (!jobs.size) for (const link of body.match(/https?:\/\/[^\s<>"']+/g)?.slice(0,500) ?? []) {
    const url=canonicalUrl(link.replace(/[).,;]+$/,''))
    if (!url) continue
    const known=identity(url)
    if (known) jobs.set(url,{ ...manualCandidate({ url,description: plainText(body).slice(0,50000) }),...known,parsing_confidence:'low' })
    if (jobs.size>=50) break
  }
  if (jobs.size) return [...jobs.values()]
  const senderDomain=sender?.match(/@([a-z0-9.-]+)>?$/i)?.[1]?.toLowerCase()
  const provider=domains.find(([d])=>senderDomain===d || senderDomain?.endsWith(`.${d}`))?.[1] ?? 'Other email alert'
  return explicit.map(job=>({...job,provider,parsing_confidence:'low'}))
}
