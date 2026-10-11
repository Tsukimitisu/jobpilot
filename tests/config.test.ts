import { describe, expect, it } from 'vitest'
import { readSupabaseConfig } from '../src/lib/config'
import { loginDestination } from '../src/auth/routing'
import { signInError } from '../src/auth/errors'

// Synthetic structural fixtures only; never used for requests or account creation.
const publicKey = 'sb_publishable_' + 'a'.repeat(32)

describe('configuration boundary', () => {
  it.each([undefined, '', ' '])('rejects missing config: %s', value => {
    expect(readSupabaseConfig(value, publicKey).config).toBeNull()
    expect(readSupabaseConfig('https://project.supabase.co', value).config).toBeNull()
  })
  it.each(['not a url', 'http://project.supabase.co', 'https://user:password@project.supabase.co',
    'https://project.supabase.co/path', 'https://project.supabase.co?key=secret',
    'https://project.supabase.co#token', 'https://your-project-ref.supabase.co'])('rejects malformed URL without echoing it', url => {
    const result = readSupabaseConfig(url, publicKey)
    expect(result.config).toBeNull()
    expect(result.error).not.toContain(url)
    expect(result.error).not.toContain(publicKey)
  })
  it.each(['sb_secret_DO_NOT_USE', 'service_role', 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
    'sb_publishable_REPLACE_WITH_YOUR_PUBLISHABLE_KEY'])('rejects non-publishable and placeholder keys', key => {
    const result = readSupabaseConfig('https://project.supabase.co', key)
    expect(result.config).toBeNull()
    expect(result.error).not.toContain(key)
  })
  it('normalizes valid public configuration and permits local development', () => {
    expect(readSupabaseConfig(' https://project.supabase.co/ ', publicKey).config?.url).toBe('https://project.supabase.co')
    expect(readSupabaseConfig('http://127.0.0.1:54321', publicKey).error).toBeNull()
  })
})

it('only redirects back to implemented application routes', () => {
  for (const from of ['/dashboard', '/jobs', '/applications', '/settings']) expect(loginDestination({ from })).toBe(from)
  for (const from of ['https://attacker.invalid', '//attacker.invalid', '/login', '/missing', {}, null]) {
    expect(loginDestination({ from })).toBe('/dashboard')
  }
})

it('maps auth errors to safe actionable copy', () => {
  expect(signInError({ code: 'invalid_credentials' })).toContain('incorrect')
  expect(signInError({ status: 429 })).toContain('Wait')
  expect(signInError({ code: 'email_not_confirmed' })).toContain('confirmation')
  expect(signInError({ status: 500 })).toContain('connection')
})
