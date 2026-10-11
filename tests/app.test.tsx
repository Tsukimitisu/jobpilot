import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

const mock = vi.hoisted(() => ({
  listeners: new Set<(event: AuthChangeEvent, session: Session | null) => void>(),
  getSession: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(),
  configured: true,
}))
vi.mock('../src/lib/supabase', () => ({
  get supabase() { return mock.configured ? { auth: authClient } : null },
  get setupError() { return mock.configured ? null : 'Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your environment.' },
}))
const authClient = {
  getSession: mock.getSession, signInWithPassword: mock.signInWithPassword, signOut: mock.signOut,
  onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
    mock.listeners.add(callback)
    return { data: { subscription: { unsubscribe: () => mock.listeners.delete(callback) } } }
  },
}
import App from '../src/App'

function session(): Session {
  // Inert test-only session. No server, persisted token, or account is created.
  return { user: { id: 'test-owner', email: 'owner@test.invalid' }, expires_at: Math.floor(Date.now() / 1000) + 3600 } as Session
}
function emit(event: AuthChangeEvent, value: Session | null) {
  for (const listener of mock.listeners) listener(event, value)
}
function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<StrictMode><App /></StrictMode>)
}
async function fillLogin() {
  await screen.findByLabelText('Email address')
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'owner@test.invalid' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'inert-test-input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  mock.configured = true
  mock.listeners.clear()
  mock.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null })
  mock.signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: { code: 'invalid_credentials' } })
  mock.signOut.mockReset().mockResolvedValue({ error: null })
  vi.stubGlobal('scrollTo', vi.fn())
  // Any unintended network request fails; these tests cannot contact Supabase.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in local tests') }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('configuration and routing', () => {
  it('shows setup guidance without starting authentication when unconfigured', () => {
    mock.configured = false
    open('/dashboard')
    expect(screen.getByRole('heading', { name: 'Let’s connect your workspace.' })).toBeTruthy()
    expect(mock.getSession).not.toHaveBeenCalled()
  })
  it.each(['/dashboard', '/jobs', '/applications', '/settings'])('protects %s and preserves its destination', async path => {
    open(path)
    await screen.findByLabelText('Email address')
    expect(window.location.pathname).toBe('/login')
    mock.signInWithPassword.mockImplementation(async () => { emit('SIGNED_IN', session()); return { error: null } })
    await fillLogin()
    await waitFor(() => expect(window.location.pathname).toBe(path))
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
  })
  it('redirects an authenticated login to the dashboard', async () => {
    mock.getSession.mockResolvedValue({ data: { session: session() }, error: null })
    open('/login')
    await screen.findByText('Your setup checklist')
    expect(window.location.pathname).toBe('/dashboard')
  })
  it('renders an honest unknown-route page', async () => {
    open('/not-a-page')
    await screen.findByRole('heading', { name: 'Page not found' })
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/login')
  })
})

describe('session lifecycle', () => {
  it('keeps initial loading until restoration finishes and cleans StrictMode subscriptions', async () => {
    let restore!: (value: unknown) => void
    mock.getSession.mockImplementation(() => new Promise(resolve => { restore = resolve }))
    const view = open('/jobs')
    expect(screen.getByRole('status').textContent).toContain('Restoring')
    expect(screen.queryByLabelText('Email address')).toBeNull()
    expect(mock.listeners.size).toBe(1)
    await act(async () => restore({ data: { session: session() }, error: null }))
    expect(screen.getByRole('heading', { name: 'Jobs' })).toBeTruthy()
    view.unmount()
    expect(mock.listeners.size).toBe(0)
  })
  it('does not let a late initial read resurrect a signed-out session', async () => {
    let restore!: (value: unknown) => void
    mock.getSession.mockImplementation(() => new Promise(resolve => { restore = resolve }))
    open('/dashboard')
    await act(async () => emit('SIGNED_OUT', null))
    await screen.findByLabelText('Email address')
    await act(async () => restore({ data: { session: session() }, error: null }))
    expect(screen.queryByText('Your setup checklist')).toBeNull()
    expect(window.location.pathname).toBe('/login')
  })
  it('shows recoverable initialization errors', async () => {
    mock.getSession.mockRejectedValue(new Error('private backend details'))
    open('/dashboard')
    await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByRole('alert').textContent).toContain('Could not restore')
    expect(document.body.textContent).not.toContain('private backend details')
  })
  it('times out stalled session restoration', async () => {
    vi.useFakeTimers()
    mock.getSession.mockReturnValue(new Promise(() => {}))
    open('/dashboard')
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(screen.getByRole('alert').textContent).toContain('too long')
  })
  it('rejects expired restored sessions', async () => {
    mock.getSession.mockResolvedValue({ data: { session: { ...session(), expires_at: 1 } }, error: null })
    open('/dashboard')
    await screen.findByLabelText('Email address')
    expect(screen.getByText('Your session ended. Please sign in again.').getAttribute('role')).toBe('status')
  })
  it('removes private UI when the access token expires without a refresh', async () => {
    vi.useFakeTimers()
    mock.getSession.mockResolvedValue({ data: { session: { ...session(), expires_at: Math.floor(Date.now() / 1000) + 2 } }, error: null })
    open('/dashboard')
    await act(async () => {})
    expect(screen.getByText('Your setup checklist')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.getByLabelText('Email address')).toBeTruthy()
    expect(screen.queryByText('Your setup checklist')).toBeNull()
  })
  it('signs out, clears user UI, and guards browser-back navigation', async () => {
    mock.getSession.mockResolvedValue({ data: { session: session() }, error: null })
    mock.signOut.mockImplementation(async () => { emit('SIGNED_OUT', null); return { error: null } })
    open('/settings')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await screen.findByLabelText('Email address')
    expect(mock.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(document.body.textContent).not.toContain('owner@test.invalid')
    await act(async () => { window.history.pushState(null, '', '/jobs'); window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(window.location.pathname).toBe('/login')
  })
  it('accepts token refreshes and expires at the updated deadline', async () => {
    vi.useFakeTimers()
    const original = { ...session(), expires_at: Math.floor(Date.now() / 1000) + 2 }
    mock.getSession.mockResolvedValue({ data: { session: original }, error: null })
    open('/dashboard')
    await act(async () => {})
    await act(async () => emit('TOKEN_REFRESHED', { ...original, expires_at: original.expires_at + 100 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(screen.getByText('Your setup checklist')).toBeTruthy()
    await act(async () => emit('SIGNED_OUT', null))
    expect(screen.getByLabelText('Email address')).toBeTruthy()
  })
  it('navigates between the real screens and exposes their honest status', async () => {
    mock.getSession.mockResolvedValue({ data: { session: session() }, error: null })
    open('/dashboard')
    await screen.findByText('Your setup checklist')
    fireEvent.click(screen.getAllByRole('link', { name: 'Jobs' })[0])
    expect(screen.getByText('Your opportunities will live here.')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('link', { name: 'Applications' })[0])
    expect(screen.getByText('No applications have been sent.')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('link', { name: 'Settings' })[0])
    expect(screen.getByText('Not connected')).toBeTruthy()
    expect(screen.getByText('Not implemented')).toBeTruthy()
    expect(document.activeElement?.id).toBe('main-content')
  })
})

describe('forms and failures', () => {
  it('validates fields accessibly without a backend request', async () => {
    open('/login')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('alert').textContent).toContain('valid email')
    expect(screen.getByLabelText('Email address').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('alert'))
    expect(mock.signInWithPassword).not.toHaveBeenCalled()
  })
  it('shows invalid credentials and clears the submitted password', async () => {
    open('/login')
    await fillLogin()
    expect((await screen.findByRole('alert')).textContent).toContain('incorrect')
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
  })
  it('disables duplicate submissions while sign-in is pending', async () => {
    mock.signInWithPassword.mockReturnValue(new Promise(() => {}))
    open('/login')
    await fillLogin()
    expect((screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(screen.getByLabelText('Password').closest('form')!)
    expect(mock.signInWithPassword).toHaveBeenCalledTimes(1)
  })
  it('handles rejected network requests without displaying raw details', async () => {
    mock.signInWithPassword.mockRejectedValue(new Error('private backend details'))
    open('/login')
    await fillLogin()
    expect((await screen.findByRole('alert')).textContent).toContain('connection')
    expect(document.body.textContent).not.toContain('private backend details')
  })
  it('does not pretend sign-out succeeded when it fails', async () => {
    mock.getSession.mockResolvedValue({ data: { session: session() }, error: null })
    mock.signOut.mockResolvedValue({ error: { message: 'private backend details' } })
    open('/settings')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Sign-out could not finish')
    expect(window.location.pathname).toBe('/settings')
  })
})
