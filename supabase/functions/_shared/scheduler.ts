import type { SupabaseClient } from '@supabase/supabase-js'
import { ServiceError } from './google.ts'
import { importSource, safeCode, type BackendConfig } from './service.ts'

type Run = { id: string; owner_id: string }
type Result = { source_id: string; status: string; added?: number; duplicates?: number; more?: boolean; error_code?: string }
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new ServiceError('database_error')
  return result.data
}
async function authentic(request: Request, secret: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret)) throw new ServiceError('scheduler_configuration')
  const supplied = request.headers.get('Authorization')?.match(/^Bearer (\d{10})\.([a-f0-9]{64})$/)
  if (!supplied) return false
  const age = Math.floor(Date.now() / 1000) - Number(supplied[1])
  if (age < -30 || age > 300) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const signature = Uint8Array.from(supplied[2].match(/../g)!, value => Number.parseInt(value, 16))
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(`jobpilot-discovery-v1:${supplied[1]}`))
}

// No action dispatcher, user ID, email recipient, or send path in this endpoint.
export function schedulerHandler(db: SupabaseClient, config: BackendConfig, secret: string, transport: typeof fetch = fetch) {
  return async (request: Request) => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
    let run: Run | null = null
    const results: Result[] = []
    try {
      if (!await authentic(request, secret)) return reply({ error: 'unauthorized' }, 401)
      // Ignore the body entirely: it cannot select the owner, sources, or workflow.
      run = checked(await db.rpc('claim_discovery_automation')) as Run | null
      if (!run?.id) return reply({ status: 'skipped' })
      const deadline = Date.now() + 100000
      const guard = async () => {
        if (Date.now() >= deadline) throw new ServiceError('interrupted')
        if (checked(await db.rpc('discovery_automation_active', { p_run: run!.id })) !== true) throw new ServiceError('automation_paused')
      }
      let requests = 0
      const bounded: typeof fetch = async (input, init) => {
        if (++requests > 40 || Date.now() >= deadline) throw new ServiceError('interrupted')
        return transport(input, { ...init, signal: AbortSignal.any([init?.signal ?? new AbortController().signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) })
      }
      const sources = checked(await db.rpc('scheduled_discovery_sources', { p_run: run.id })) as { id: string }[]
      for (const source of sources) {
        await guard()
        try {
          const result = await importSource(db, run.owner_id, source.id, config.google, bounded, { runId: run.id, deadline, guard }, config.adzuna)
          results.push({ source_id: source.id, status: 'succeeded', ...result })
        } catch (error) { results.push({ source_id: source.id, status: 'failed', error_code: safeCode(error) }) }
      }
      await guard()
      const failures = results.filter(item => item.status === 'failed')
      const status = failures.length === results.length && failures.length ? 'failed' : failures.length ? 'partial' : 'succeeded'
      checked(await db.rpc('finish_discovery_automation', { p_run: run.id, p_status: status, p_error: failures[0]?.error_code ?? null, p_results: results }))
      return reply({ status, run_id: run.id })
    } catch (error) {
      const code = safeCode(error)
      if (run?.id) {
        // If even acknowledgement fails the lease is recovered as interrupted on a later tick.
        await db.rpc('finish_discovery_automation', { p_run: run.id, p_status: code === 'automation_paused' ? 'paused' : 'failed', p_error: code, p_results: results })
      }
      return reply({ error: code }, 503)
    }
  }
}
