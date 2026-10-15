import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { parseJobAlert } from '../supabase/functions/_shared/alerts'
import { connectorPage, discoveryTransport, retryAfter, ProviderError } from '../supabase/functions/_shared/connectors'
import { emptySearchProfile, scoreSearch, validSearchProfile } from '../supabase/functions/_shared/search'
import { manualCandidate } from '../supabase/functions/_shared/discovery'
import { alerts, explicitAlert } from './fixtures/alerts'
const json=(value:unknown,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers})
const profile=()=>({...emptySearchProfile(),id:'p',name:'Entry developer',desired_titles:['Junior Developer'],enabled:true,results_limit:2})
const source=(kind:string,cursor:string|null=null)=>({kind,source_key:kind==='adzuna'?'sg':'fixture',name:'Fixture',cursor})
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Live network prohibited')}))})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('synthetic alert fixtures',()=>{
  it.each(alerts)('recognizes $provider direct links without visiting them',({provider,body})=>{
    const [job]=parseJobAlert(body,'alerts@example.invalid')
    expect(job.provider).toBe(provider);expect(job.parsing_confidence).toBe('medium');expect(job.company).toBeNull();expect(fetch).not.toHaveBeenCalled()
  })
  it('extracts only explicit experience, employment and salary fields',()=>{
    expect(parseJobAlert(explicitAlert,null)[0]).toMatchObject({parsing_confidence:'high',experience_years:1,employment_type:'full-time',salary_min:30000,salary_currency:'PHP'})
  })
  it('marks unrecognized or plain URL alerts low confidence, retaining their original content',()=>{
    expect(parseJobAlert('An opportunity: https://www.linkedin.com/jobs/view/123',null)[0]).toMatchObject({title:null,provider:'LinkedIn',parsing_confidence:'low'})
    expect(parseJobAlert('Ambiguous alert with no jobs.',null)[0]).toMatchObject({title:null,canonical_url:null,parsing_confidence:'low'})
  })
  it('does not trust lookalike hosts, tracking redirects or generic Apply links',()=>{
    for(const url of ['https://linkedin.com.evil.invalid/jobs/view/123','https://evil.invalid/?url=https://linkedin.com/jobs/view/123']) expect(parseJobAlert(`<a href="${url}">Engineer</a>`,null)[0].canonical_url).toBeNull()
    expect(parseJobAlert('<a href="https://linkedin.com/jobs/view/123">Apply now</a>',null)[0].title).toBeNull()
  })
  it('caps extraction and renders untrusted markup as text',()=>{
    const jobs=parseJobAlert(Array.from({length:80},(_,i)=>`<a href="https://linkedin.com/jobs/view/${i}">Job ${i}</a>`).join(''),null)
    expect(jobs).toHaveLength(50);expect(jobs[0].description).not.toContain('<a')
  })
})
describe('search profile validation and explained matching',()=>{
  it('rejects missing titles and invalid numeric/list choices',()=>{
    expect(validSearchProfile(emptySearchProfile())).toBe(false);expect(validSearchProfile(profile())).toBe(true)
    for(const patch of [{results_limit:51},{results_limit:0},{max_experience:-1},{minimum_salary:Infinity},{work_modes:['teleport']},{employment_types:['anything']},{desired_titles:Array(21).fill('x')}])expect(validSearchProfile({...profile(),...patch})).toBe(false)
  })
  it('explains positive, exclusion and experience reasons without inferring unknowns',()=>{
    const p={...profile(),required_keywords:['TypeScript'],excluded_keywords:['Senior'],locations:['Cebu'],work_modes:['remote'],max_experience:0,employment_types:['full-time']}
    const job=parseJobAlert(explicitAlert,null)[0], result=scoreSearch(job,p)
    expect(result.reasons).toEqual(expect.arrayContaining(['Title matched','Required keyword matched: TypeScript','Preferred location matched','Remote preference matched','Experience requirement too high']))
    expect(scoreSearch({...job,description:'Senior TypeScript'},p).reasons).toContain('Excluded keyword found: Senior')
    expect(scoreSearch(manualCandidate({description:'No structured details'}),p).reasons).toContain('Salary unknown')
  })
  it('does not compare foreign salaries to PHP monthly preferences',()=>{
    const job={...manualCandidate({description:'fixture'}),salary_min:50000,salary_currency:'USD',salary_period:'year'}
    expect(scoreSearch(job,{...profile(),minimum_salary:30000}).reasons).toContain('Salary cannot be compared to PHP per month')
  })
})
describe('public connector pagination and failures',()=>{
  it('bounds Lever pagination, keeps unknown company and uses GET only',async()=>{
    const transport=vi.fn(async(input,init)=>{expect(String(input)).toContain('skip=2&limit=2');expect(init.method??'GET').toBe('GET');return json([{id:'a',text:'Developer',hostedUrl:'https://jobs.lever.co/fixture/a',categories:{location:'Manila',commitment:'Full-time'}},{id:'b',text:'QA'}])})
    const page=await connectorPage(source('lever','2'),2,[],undefined,transport)
    expect(page.cursor).toBe('4');expect(page.jobs[0].job.company).toBeNull();expect(page.jobs[0].job.employment_type).toBe('full-time')
  })
  it('continues Ashby by stable job URL and excludes unlisted jobs',async()=>{
    const transport=vi.fn(async()=>json({jobs:[{title:'A',isListed:true,jobUrl:'https://jobs.ashbyhq.com/fixture/a'},{title:'B',isListed:true,jobUrl:'https://jobs.ashbyhq.com/fixture/b'},{title:'Hidden',isListed:false,jobUrl:'https://jobs.ashbyhq.com/fixture/c'}]}))
    const page=await connectorPage(source('ashby'),1,[],undefined,transport)
    expect(page.jobs).toHaveLength(1);expect(page.cursor).toContain('/a')
    const next=await connectorPage(source('ashby',page.cursor),1,[],undefined,transport)
    expect(next.jobs[0].job.title).toBe('B');expect(next.cursor).toBeNull()
  })
  it('missing Adzuna secrets makes zero requests',async()=>{
    const transport=vi.fn()
    await expect(connectorPage(source('adzuna'),2,[profile()],undefined,transport)).rejects.toThrow('not_configured')
    expect(transport).not.toHaveBeenCalled()
  })
  it('bounds Adzuna to three pages per title, resumes and restarts on profile change',async()=>{
    const transport=vi.fn(async()=>json({results:[{id:'1',title:'A'},{id:'2',title:'B'}]})),credentials={appId:'inert-id',appKey:'inert-key'}
    let cursor:string|null=null
    for(let i=1;i<=3;i++){
      const page=await connectorPage(source('adzuna',cursor),2,[profile()],credentials,transport)
      expect(String(transport.mock.calls.at(-1)![0])).toContain(`/search/${i}?`)
      cursor=page.cursor
    }
    expect(cursor).toBeNull()
    const page=await connectorPage(source('adzuna'),2,[profile()],credentials,transport)
    await connectorPage(source('adzuna',page.cursor),2,[{...profile(),desired_titles:['Changed']}],credentials,transport)
    expect(String(transport.mock.calls.at(-1)![0])).toContain('/search/1?')
  })
  it('rejects invalid boards and unsupported markets without requests',async()=>{
    const transport=vi.fn()
    for(const bad of [{...source('lever'),source_key:'../../private'},{...source('adzuna'),source_key:'ph'}])await expect(connectorPage(bad,2,[],undefined,transport)).rejects.toThrow('invalid_source')
    expect(transport).not.toHaveBeenCalled()
  })
  it('handles HTML rate limits and Retry-After without exposing payloads',async()=>{
    const transport=vi.fn(async()=>new Response('private diagnostic',{status:429,headers:{'Retry-After':'3600'}}))
    try{await connectorPage(source('lever'),2,[],undefined,transport);throw new Error('Expected failure')}catch(error){expect(error).toBeInstanceOf(ProviderError);expect((error as ProviderError).code).toBe('rate_limited');expect((error as ProviderError).retryAt).not.toBeNull();expect(String(error)).not.toContain('diagnostic')}
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('supports date retry headers and leaves absent/invalid headers for exponential backoff',()=>{
    expect(retryAfter('120',0)).toBe('1970-01-01T00:02:00.000Z');expect(retryAfter('Wed, 01 Jan 2031 00:00:00 GMT',0)).toBe('2031-01-01T00:00:00.000Z');expect(retryAfter('invalid')).toBeNull()
  })
  it('attaches a request timeout and sanitizes transport exceptions',async()=>{
    const transport=vi.fn(async(_url,init)=>{expect(init.signal).toBeInstanceOf(AbortSignal);throw new Error('inert-key must not escape')})
    await expect(connectorPage(source('adzuna'),2,[profile()],{appId:'inert',appKey:'inert-key'},transport)).rejects.toThrow('provider_unavailable')
  })
  it('aborts a stalled provider request when its timeout expires',async()=>{
    const controller=new AbortController()
    vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal)
    let dispatched!:()=>void
    const started=new Promise<void>(resolve=>{dispatched=resolve})
    const transport:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new Error('timeout with private URL')));dispatched()})
    const pending=connectorPage(source('lever'),2,[],undefined,transport)
    const check=expect(pending).rejects.toThrow('provider_unavailable')
    await started;controller.abort();await check
  })
  it('fails safely on invalid data, overlarge bodies and redirects',async()=>{
    await expect(connectorPage(source('ashby'),2,[],undefined,async()=>json({jobs:'bad'}))).rejects.toThrow('provider_unavailable')
    await expect(connectorPage(source('ashby'),2,[],undefined,async()=>json({jobs:[]},200,{'content-length':'9000000'}))).rejects.toThrow('response_too_large')
    const transport=vi.fn(async(_url,init)=>{expect(init.redirect).toBe('error');return json([])})
    await connectorPage(source('lever'),2,[],undefined,transport)
  })
  it('preserves scheduler guard errors instead of retrying them',async()=>{
    const {ServiceError}=await import('../supabase/functions/_shared/google')
    await expect(discoveryTransport(async()=>{throw new ServiceError('automation_paused')})('https://example.invalid')).rejects.toThrow('automation_paused')
  })
})
