import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readSupabaseConfig } from './config'

const result = readSupabaseConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
let client: SupabaseClient | null = null
let error = result.error
if (result.config) {
  try {
    client = createClient(result.config.url, result.config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: {
        fetch: (input, init) => fetch(input, {
          ...init,
          cache: 'no-store',
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(String(input).includes('/functions/v1/jobpilot-api') ? 120_000 : 12_000)])
            : AbortSignal.timeout(12_000),
        }),
      },
    })
  } catch {
    error = 'The authentication client could not start. Check the project configuration and allow browser storage, then reload.'
  }
}
export const supabase = client
export const setupError = error
