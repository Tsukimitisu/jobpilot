import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WorkspaceContext, useWorkspace, useWorkspaceState } from './useWorkspace'

export function WorkspaceProvider({ client, ownerId, children }: { client: SupabaseClient; ownerId: string; children: ReactNode }) {
  const workspace = useWorkspaceState(client, ownerId)
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>
}
export function OwnerContent({ children }: { children: ReactNode }) {
  const { data, loading, error, refresh, online } = useWorkspace()
  if (!data && loading) return <p role="status">Loading your private workspace…</p>
  if (!data || !data.owner) return <section className="panel settings-section"><h2>Owner access required</h2>
    <p>{error ?? 'This account is not the registered owner, or ownership has not been configured. Complete the administrator-only bootstrap in Supabase. Signing in does not grant ownership.'}</p>
    <button className="button button-secondary" disabled={loading || !online} onClick={() => void refresh()}>Retry access check</button>
  </section>
  return <>{error && <p className="error-message" role="alert">{error} Previously loaded data may be out of date.</p>}{children}</>
}
