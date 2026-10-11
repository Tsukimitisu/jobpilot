import { useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'

type AuthState = { session: Session | null; loading: boolean; error: string | null; notice: string | null }
const initialState: AuthState = { session: null, loading: true, error: null, notice: null }

export function useAuth(client: SupabaseClient) {
  const [state, setState] = useState<AuthState>(initialState)
  useEffect(() => {
    let active = true
    let revision = 0
    const acceptSession = (session: Session | null) => {
      const valid = session && session.expires_at && session.expires_at * 1000 > Date.now()
      setState(previous => ({ session: valid ? session : null, loading: false, error: null,
        notice: !valid && (session || previous.session) ? 'Your session ended. Please sign in again.' : null }))
    }
    const timer = window.setTimeout(() => {
      if (active) setState(previous => previous.loading
        ? { ...initialState, loading: false, error: 'Session recovery took too long. Check your connection and try again.' } : previous)
    }, 15_000)
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      revision += 1
      acceptSession(session)
    })
    // A late initial read must never overwrite a newer sign-in/sign-out event.
    const startingRevision = revision
    void client.auth.getSession().then(({ data, error }) => {
      if (!active || revision !== startingRevision) return
      if (error) setState({ ...initialState, loading: false, error: 'Could not restore your session. Check your connection and try again.' })
      else acceptSession(data.session)
    }).catch(() => {
      if (active && revision === startingRevision) setState({ ...initialState, loading: false, error: 'Could not restore your session. Check your connection and try again.' })
    })
    return () => { active = false; window.clearTimeout(timer); subscription.unsubscribe() }
  }, [client])

  useEffect(() => {
    if (!state.session?.expires_at) return
    const expiresAt = state.session.expires_at * 1000
    const expire = () => {
      if (Date.now() >= expiresAt) setState(previous =>
        previous.session?.expires_at === state.session?.expires_at
          ? { session: null, loading: false, error: null, notice: 'Your session expired. Please sign in again.' } : previous)
    }
    const timer = window.setTimeout(expire, Math.max(0, expiresAt - Date.now()))
    window.addEventListener('focus', expire)
    document.addEventListener('visibilitychange', expire)
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', expire); document.removeEventListener('visibilitychange', expire) }
  }, [state.session])
  return state
}
