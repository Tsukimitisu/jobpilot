import type { SupabaseClient } from '@supabase/supabase-js'
import { discoveryAction } from './discovery'
import { WorkspaceError } from './workspace'
import type { Application, ApplicationStatus } from '../../supabase/functions/_shared/application-data'
export type { Application }
export const applicationLabels: Record<ApplicationStatus,string> = { draft: 'Draft', ready: 'Ready', sending: 'Sending', sent: 'Sent', failed: 'Failed', delivery_unknown: 'Delivery unknown', external: 'Sent outside JobPilot' }
export async function loadApplications(client: SupabaseClient) {
  const all: Application[] = []
  for (;;) {
    const result = await client.from('applications').select('*').order('created_at',{ ascending: false }).order('id').range(all.length,all.length+499)
    if (result.error) throw new WorkspaceError('Could not load applications. Check your connection and Phase 4 setup, then refresh.')
    all.push(...result.data as Application[])
    if (result.data.length < 500) return all
  }
}
export const applicationAction = (client: SupabaseClient, body: Record<string,unknown>) => discoveryAction<Application>(client,body)
