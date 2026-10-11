export type SupabaseConfig = { url: string; publishableKey: string }
export type ConfigResult =
  | { config: SupabaseConfig; error: null }
  | { config: null; error: string }

// Structural validation only; the Auth server determines key validity.
// Never include supplied values in errors, even if a secret was pasted by mistake.
export function readSupabaseConfig(urlValue: unknown, keyValue: unknown): ConfigResult {
  if (typeof urlValue !== 'string' || typeof keyValue !== 'string' || !urlValue.trim() || !keyValue.trim()) {
    return { config: null, error: 'Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your environment.' }
  }
  const url = urlValue.trim()
  const publishableKey = keyValue.trim()
  try {
    const parsed = new URL(url)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
        parsed.username || parsed.password || parsed.search || parsed.hash ||
        !['', '/'].includes(parsed.pathname) ||
        /your[-_]|example|placeholder/i.test(parsed.hostname)) throw new Error()
  } catch {
    return { config: null, error: 'VITE_SUPABASE_URL must be the HTTPS project URL from Supabase. Local development URLs may use HTTP.' }
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey) || /placeholder|your[_-]|example/i.test(publishableKey)) {
    return { config: null, error: 'Use a Supabase publishable key (starting with sb_publishable_) for VITE_SUPABASE_PUBLISHABLE_KEY. Secret and administrator keys are not supported.' }
  }
  return { config: { url: url.replace(/\/$/, ''), publishableKey }, error: null }
}
