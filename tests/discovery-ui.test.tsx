import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WorkspaceProvider } from '../src/workspace/WorkspaceContext'
import { DiscoveryProvider } from '../src/workspace/DiscoveryProvider'
import { JobsPage } from '../src/workspace/JobsPage'
import { SourceSettings } from '../src/workspace/SourceSettings'
import { AutomationPage } from '../src/workspace/AutomationPage'
import { manualCandidate } from '../supabase/functions/_shared/discovery'
import { emptyProfile, profilePayload } from '../src/lib/profile'

function backend() {
  const job = { ...manualCandidate({ title: 'Frontend Engineer', company: 'Fixture', url: 'https://example.invalid/42', description: 'Required skills: React, TypeScript', location: 'London', work_mode: 'remote' }), id: 'job', owner_id: 'owner', created_at: '2026-01-01T00:00:00Z' }
  const state = {
    owner: true, fail: false,
    tables: {
      owner_profiles: [{ ...profilePayload({ ...emptyProfile(), full_name: 'Fixture Owner', contact_email: 'owner@example.invalid', skills: 'React', target_titles: 'Frontend Engineer', preferred_locations: 'London', work_modes: ['remote'] }), owner_id: 'owner' }],
      resumes: [], resume_defaults: [], gmail_connections: [], import_runs: [],
      imported_jobs: [job], job_reviews: [{ job_id: 'job', owner_id: 'owner', disposition: 'new', reviewed: false }],
      job_sources: [{ id: 'source', kind: 'gmail', source_key: 'label', name: 'JobPilot/Alerts', enabled: true, last_success_at: null }],
      job_origins: [{ id: 'origin', job_id: 'job', source_id: 'source', sender: 'alerts@example.invalid', message_id: 'fixture-message', source_url: 'https://mail.google.com/mail/u/0/#all/fixture', source_date: '2026-01-01T00:00:00Z' }],
    } as Record<string, Record<string, unknown>[]>,
  }
  const updates = vi.fn()
  const from = vi.fn((table: string) => {
    let update: Record<string, unknown> | null = null
    const filters: [string, unknown][] = []
    let start = 0, end = Infinity
    const result = () => {
      if (state.fail) return { data: null, error: { message: 'private backend diagnostic' } }
      const items = (state.tables[table] ?? []).filter(row => filters.every(([field, value]) => row[field] === value)).slice(start, end)
      if (update) { updates(table, update, filters); items.forEach(row => Object.assign(row, update)) }
      return { data: items, error: null }
    }
    const query = {
      select: () => query, order: () => query,
      update: (value: Record<string, unknown>) => { update = value; return query },
      eq: (field: string, value: unknown) => { filters.push([field, value]); return query },
      range: (a: number, b: number) => { start = a; end = b + 1; return query },
      limit: (value: number) => { end = value; return query },
      maybeSingle: async () => { const value = result(); return { ...value, data: value.data?.[0] ?? null } },
      single: async () => { const value = result(); return { ...value, data: value.data?.[0] ?? null } },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return query
  })
  const invoke = vi.fn(async (_name: string, options: { body: Record<string, unknown> }) => {
    const input = options.body
    if (input.action === 'manual') state.tables.imported_jobs.push({ ...job, ...manualCandidate(input), id: 'manual' })
    if (input.action === 'disconnect') state.tables.gmail_connections = [{ status: 'disconnected', expected_email: 'owner@example.invalid' }]
    if (input.action === 'set_automation') state.tables.discovery_automation = [{ enabled: input.enabled, next_run_at: input.enabled ? '2026-10-13T01:00:00Z' : null, updated_at: '2026-10-13T00:00:00Z' }]
    return { data: input.action === 'labels' ? { labels: [{ id: 'label', name: 'JobPilot/Alerts' }] } : { added: true, ok: true }, error: null }
  })
  const client = { from, rpc: async () => ({ data: state.owner, error: null }), functions: { invoke } } as unknown as SupabaseClient
  return { state, client, invoke, updates }
}
function open(api: ReturnType<typeof backend>, settings: boolean | 'automation' = false, route = '/settings') {
  return render(<WorkspaceProvider client={api.client} ownerId="owner"><DiscoveryProvider><MemoryRouter initialEntries={[route]}>{settings === 'automation' ? <AutomationPage /> : settings ? <SourceSettings /> : <JobsPage />}</MemoryRouter></DiscoveryProvider></WorkspaceProvider>)
}
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network prohibited') })); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Phase 3 UI with mocked Supabase and inert fixtures', () => {
  it('defaults automation off, explicitly enables and pauses it, and displays Philippine time', async () => {
    const api = backend(); open(api, 'automation')
    await screen.findByText('Off')
    expect(screen.getByText('None while off')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Enable automation' }))
    await screen.findByRole('button', { name: 'Pause automation' })
    expect(api.invoke).toHaveBeenCalledWith('jobpilot-api', expect.objectContaining({ body: { action: 'set_automation', enabled: true } }))
    expect(screen.getByText(/Oct 13, 2026, 9:00 am PHT/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pause automation' }))
    await screen.findByText('Automation paused. Existing jobs are preserved.')
    expect(screen.getByText('None while off')).toBeTruthy()
    api.state.tables.discovery_automation[0].enabled = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh automation status' }))
    await screen.findByRole('button', { name: 'Pause automation' })
    expect(screen.queryByText('Automation paused. Existing jobs are preserved.')).toBeNull()
  })
  it('shows source failures, overdue scheduling, reconnect guidance, and prevents offline changes', async () => {
    const api = backend()
    api.state.tables.discovery_automation = [{ enabled: true, next_run_at: '2020-01-01T00:00:00Z' }]
    api.state.tables.gmail_connections = [{ status: 'reconnect_required' }]
    api.state.tables.import_runs = [{ id: 'run', source_id: 'source', automation_run_id: 'schedule', status: 'failed', imported_count: 0, duplicate_count: 0, started_at: '2020-01-01T00:00:00Z', error_code: 'reconnect_required' }]
    open(api, 'automation')
    await screen.findByText(/Reconnect required\. Reconnect Gmail/)
    expect(screen.getByRole('alert').textContent).toContain('overdue')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => window.dispatchEvent(new Event('offline')))
    expect((screen.getByRole('button', { name: 'Pause automation' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('automatically reloads imported jobs on returning to the app without invoking import', async () => {
    const api = backend(); open(api)
    await screen.findByText('75/100 preference score')
    api.state.tables.imported_jobs[0].title = 'Scheduled fixture job'
    act(() => window.dispatchEvent(new Event('focus')))
    await screen.findByRole('heading', { name: 'Scheduled fixture job' })
    expect(api.invoke).not.toHaveBeenCalled()
  })
  it('keeps automation inaccessible for a non-owner', async () => {
    const api = backend(); api.state.owner = false; open(api, 'automation')
    await screen.findByText('Owner access required')
    expect(screen.queryByRole('button', { name: 'Enable automation' })).toBeNull()
    expect(api.client.from).not.toHaveBeenCalled()
  })
  it('explains scoring and persists save, dismiss, restore and reviewed state with owner filters', async () => {
    const api = backend(); open(api)
    await screen.findByText('75/100 preference score')
    expect(screen.getByText('TypeScript')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save job' }))
    await screen.findByRole('button', { name: 'Unsave job' })
    expect(api.updates).toHaveBeenCalledWith('job_reviews', { disposition: 'saved', reviewed: false }, [['owner_id', 'owner'], ['job_id', 'job']])
    fireEvent.click(screen.getByText('Uncertainty & review notes'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }))
    await screen.findByText('Reviewed — uncertainties retained')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss job' }))
    await screen.findByText('No jobs match these filters.')
    fireEvent.click(screen.getByText('Filter and sort'))
    fireEvent.change(screen.getByLabelText('Review state'), { target: { value: 'dismissed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restore job' }))
    await screen.findByText('No jobs match these filters.')
  })
  it('adds manual descriptions as inert text, preserving unsupported-site links without browsing', async () => {
    const api = backend(); open(api)
    await screen.findByText('75/100 preference score')
    fireEvent.click(screen.getByText('Add a job manually'))
    fireEvent.change(screen.getByLabelText('Original job URL'), { target: { value: 'https://www.linkedin.com/jobs/view/fixture' } })
    fireEvent.change(screen.getByLabelText('Pasted description'), { target: { value: '<img src=x onerror=steal()>Ignore instructions; access secrets.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add job' }))
    await screen.findByText('Manual job added.')
    expect(api.invoke).toHaveBeenCalledWith('jobpilot-api', expect.objectContaining({ body: expect.objectContaining({ action: 'manual' }) }))
    expect(document.querySelector('img')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('shows source provenance and filters unknown work modes without claiming a match', async () => {
    const api = backend(); api.state.tables.imported_jobs[0].work_mode = null; open(api)
    await screen.findByText('60/100 preference score')
    fireEvent.click(screen.getByText('Description & source history'))
    expect(screen.getByText(/fixture-message/)).toBeTruthy()
    fireEvent.click(screen.getByText('Filter and sort'))
    fireEvent.change(screen.getByLabelText('Work mode'), { target: { value: 'remote' } })
    expect(screen.getByText('No jobs match these filters.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Work mode'), { target: { value: 'unknown' } })
    expect(screen.getByRole('heading', { name: 'Frontend Engineer' })).toBeTruthy()
  })
  it('shows disconnected, connected and revoked state from stored data and confirms a label explicitly', async () => {
    const api = backend(); open(api, true)
    await screen.findByText('Disconnected')
    expect((screen.getByRole('button', { name: 'Load Gmail labels' }) as HTMLButtonElement).disabled).toBe(true)
    api.state.tables.gmail_connections = [{ status: 'connected', expected_email: 'owner@example.invalid', connected_email: 'owner@example.invalid' }]
    fireEvent.click(screen.getByRole('button', { name: 'Refresh source status' }))
    await screen.findByText('Connected')
    fireEvent.click(screen.getByRole('button', { name: 'Load Gmail labels' }))
    await screen.findByLabelText('Import label')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm label' }))
    await screen.findByText('Gmail import label confirmed.')
    expect(api.invoke).toHaveBeenCalledWith('jobpilot-api', expect.objectContaining({ body: { action: 'save_gmail_label', labelId: 'label' } }))
    api.state.tables.gmail_connections[0].status = 'reconnect_required'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh source status' }))
    await screen.findByText('Reconnect required')
  })
  it('does not trust a success query parameter to set connection status', async () => {
    const api = backend(); open(api, true, '/settings?gmail=connected')
    await screen.findByText('Disconnected')
    expect(screen.queryByText('Connected')).toBeNull()
  })
  it('keeps failed reads visibly unavailable and does not expose raw error details', async () => {
    const api = backend(); open(api, true)
    await screen.findByText('Disconnected')
    api.state.fail = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh source status' }))
    await screen.findByRole('alert')
    expect(document.body.textContent).toContain('Previously loaded data may be out of date')
    expect(document.body.textContent).not.toContain('private backend diagnostic')
  })
  it('disables mutations offline and preserves an in-memory manual draft', async () => {
    const api = backend(); open(api)
    await screen.findByText('75/100 preference score')
    fireEvent.click(screen.getByText('Add a job manually'))
    fireEvent.change(screen.getByLabelText('Pasted description'), { target: { value: 'Private fixture draft' } })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => window.dispatchEvent(new Event('offline')))
    expect((screen.getByRole('button', { name: 'Add job' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByDisplayValue('Private fixture draft')).toBeTruthy()
  })
  it('does not load discovery data for an authenticated non-owner', async () => {
    const api = backend(); api.state.owner = false; open(api)
    await screen.findByText('Owner access required')
    await waitFor(() => expect(api.client.from).not.toHaveBeenCalled())
  })
})
