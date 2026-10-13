import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { loadDiscovery, type Discovery } from '../lib/discovery'
import { workspaceMessage } from '../lib/workspace'
import { useWorkspace } from './useWorkspace'

export function useDiscoveryState() {
  const { client, data: workspace, online } = useWorkspace()
  const owner = workspace?.owner === true
  const [data, setData] = useState<Discovery | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [limit, setLimit] = useState(100)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState(0)
  const working = useRef(false)
  const lifecycle = useRef({ active: false, revision: 0 })
  const refresh = useCallback(async (preserveNotice = false) => {
    if (!owner) return false
    const state = lifecycle.current, revision = ++state.revision
    setLoading(true); setError(null)
    if (!preserveNotice) setNotice(null)
    try {
      const value = await loadDiscovery(client, limit)
      if (!state.active || revision !== state.revision) return false
      setData(value)
      setCheckedAt(Date.now())
      return true
    } catch (reason) {
      if (state.active && revision === state.revision) setError(workspaceMessage(reason))
      return false
    } finally { if (state.active && revision === state.revision) setLoading(false) }
  }, [client, owner, limit])
  useEffect(() => {
    const state = lifecycle.current
    state.active = true
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void refresh() })
    return () => { cancelled = true; state.active = false; state.revision++ }
  }, [refresh])
  useEffect(() => {
    if (!owner || !online) return
    const update = () => { if (document.visibilityState === 'visible' && !working.current) void refresh() }
    const interval = window.setInterval(update, 30000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [owner, online, refresh])
  async function run(work: () => Promise<string>) {
    if (working.current || !online) return false
    working.current = true; setBusy(true); setNotice(null); setActionError(null)
    let success = false
    try { const message = await work(); if (lifecycle.current.active) setNotice(message); success = true }
    catch (reason) { if (lifecycle.current.active) setActionError(workspaceMessage(reason)) }
    finally { await refresh(true); working.current = false; if (lifecycle.current.active) setBusy(false) }
    return success
  }
  return { data, error, loading, refresh, online, busy, notice, actionError, checkedAt, run, loadMore: () => setLimit(value => value + 100) }
}
export const DiscoveryContext = createContext<ReturnType<typeof useDiscoveryState> | null>(null)
export function useDiscovery() {
  const value = useContext(DiscoveryContext)
  if (!value) throw new Error('Discovery provider missing')
  return value
}
