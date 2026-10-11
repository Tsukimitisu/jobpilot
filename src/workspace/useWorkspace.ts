import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { emptyProfile, profileDraft, type Profile, type ProfileDraft } from '../lib/profile'
import { loadWorkspace, workspaceMessage, type Workspace } from '../lib/workspace'

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  return online
}
export function useWorkspaceState(client: SupabaseClient, ownerId: string) {
  const [data, setData] = useState<Workspace | null>(null)
  const [draft, setDraft] = useState<ProfileDraft>(emptyProfile)
  const [savedDraft, setSavedDraft] = useState<ProfileDraft>(emptyProfile)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileBusy, setProfileBusy] = useState(false)
  const online = useOnline()
  const initialized = useRef(false)
  const lifecycle = useRef({ active: false, revision: 0 })
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft)
  const refresh = useCallback(async () => {
    const state = lifecycle.current
    const current = ++state.revision
    setLoading(true); setError(null)
    try {
      const value = await loadWorkspace(client)
      if (!state.active || current !== state.revision) return false
      setData(value)
      if (!initialized.current) {
        initialized.current = true
        setDraft(profileDraft(value.profile)); setSavedDraft(profileDraft(value.profile))
      }
      return true
    } catch (reason) {
      if (state.active && current === state.revision) setError(workspaceMessage(reason))
      return false
    } finally { if (state.active && current === state.revision) setLoading(false) }
  }, [client])
  useEffect(() => {
    const state = lifecycle.current
    state.active = true
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void refresh() })
    return () => { cancelled = true; state.active = false; state.revision++ }
  }, [refresh])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function acceptProfile(profile: Profile | null) {
    lifecycle.current.revision++
    setLoading(false); setError(null)
    setDraft(profileDraft(profile)); setSavedDraft(profileDraft(profile))
    setData(previous => previous ? { ...previous, profile } : previous)
  }
  return { client, ownerId, data, draft, setDraft, dirty, error, loading, online, refresh, acceptProfile, profileBusy, setProfileBusy }
}
export const WorkspaceContext = createContext<ReturnType<typeof useWorkspaceState> | null>(null)
export function useWorkspace() {
  const workspace = useContext(WorkspaceContext)
  if (!workspace) throw new Error('Workspace provider missing')
  return workspace
}
