import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WorkspaceProvider } from '../src/workspace/WorkspaceContext'
import { ProfilePage } from '../src/workspace/ProfilePage'
import { ResumesPage } from '../src/workspace/ResumesPage'
import { emptyProfile, profilePayload } from '../src/lib/profile'
import { completeResume, deleteResume, downloadResume, setDefaultResume, uploadResume, validateResume, type Resume } from '../src/lib/workspace'

const ownerId = '10000000-0000-0000-0000-000000000001'
const resume: Resume = { id: '20000000-0000-0000-0000-000000000001', owner_id: ownerId, object_path: `${ownerId}/20000000-0000-0000-0000-000000000001.pdf`, original_name: 'resume.pdf', byte_size: 100, status: 'ready', created_at: '2026-01-01T00:00:00Z' }
const saved = { ...profilePayload({ ...emptyProfile(), full_name: 'Saved Owner', contact_email: 'owner@example.invalid' }), owner_id: ownerId, updated_at: '2026-01-01T00:00:00Z' }
const pdf = () => new File(['test-only inert PDF fixture'], 'resume.pdf', { type: 'application/pdf' })

function backend() {
  const state = { owner: true, profile: null as typeof saved | null, resumes: [] as Resume[], defaultId: null as string | null }
  const rpc = vi.fn(async (name: string, args?: { selected_id?: string }) => {
    if (name === 'is_jobpilot_owner') return { data: state.owner, error: null }
    if (name === 'set_default_resume') state.defaultId = args?.selected_id ?? null
    return { data: null, error: null }
  })
  const save = vi.fn(async (value: typeof saved) => { state.profile = { ...value, updated_at: saved.updated_at }; return { data: state.profile, error: null } })
  const insert = vi.fn().mockResolvedValue({ error: null })
  const removeRow = vi.fn().mockResolvedValue({ data: [{ id: resume.id }], error: null })
  const upload = vi.fn().mockResolvedValue({ error: null })
  const remove = vi.fn().mockResolvedValue({ error: null })
  const download = vi.fn().mockResolvedValue({ data: new Blob(['fixture']), error: null })
  const from = vi.fn((table: string) => ({
    select: () => ({ maybeSingle: async () => ({ data: table === 'owner_profiles' ? state.profile : state.defaultId ? { resume_id: state.defaultId } : null, error: null }), order: async () => ({ data: state.resumes, error: null }) }),
    upsert: (value: typeof saved) => ({ select: () => ({ single: () => save(value) }) }),
    insert, delete: () => ({ eq: () => ({ select: removeRow }) }),
  }))
  const client = { rpc, from, storage: { from: () => ({ upload, remove, download }) } } as unknown as SupabaseClient
  return { state, rpc, save, insert, removeRow, upload, remove, download, client }
}
function open(client: SupabaseClient, path = '/profile') {
  return render(<WorkspaceProvider ownerId={ownerId} client={client}><MemoryRouter initialEntries={[path]}><Link to="/profile">Profile page</Link><Link to="/resumes">Resume page</Link><Routes><Route path="/profile" element={<ProfilePage />} /><Route path="/resumes" element={<ResumesPage />} /></Routes></MemoryRouter></WorkspaceProvider>)
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in mocked tests') }))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.stubGlobal('confirm', vi.fn(() => true))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('profile persistence UI with mocked Supabase', () => {
  it('loads an empty profile, saves entered facts and reloads persisted data', async () => {
    const api = backend(); open(api.client)
    await screen.findByText(/No saved profile yet/)
    fireEvent.change(screen.getByLabelText('Full name (required)'), { target: { value: 'Owner' } })
    fireEvent.change(screen.getByLabelText('Contact email (required)'), { target: { value: 'owner@example.invalid' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await screen.findByText('Profile saved.')
    api.state.profile = saved
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved profile' }))
    await screen.findByText('Saved profile reloaded.')
    expect((screen.getByLabelText('Full name (required)') as HTMLInputElement).value).toBe('Saved Owner')
  })
  it('retains input when a save fails, including across in-app navigation', async () => {
    const api = backend(); api.state.profile = saved; api.save.mockRejectedValue(new Error('private details')); open(api.client)
    await screen.findByDisplayValue('Saved Owner')
    fireEvent.change(screen.getByLabelText('Full name (required)'), { target: { value: 'Unsaved Owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await screen.findByText(/Save could not be confirmed/)
    expect(document.body.textContent).not.toContain('private details')
    fireEvent.click(screen.getByText('Resume page')); fireEvent.click(screen.getByText('Profile page'))
    expect(screen.getByDisplayValue('Unsaved Owner')).toBeTruthy()
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })
  it('keeps a pending profile save locked across navigation so its result cannot overwrite new edits', async () => {
    const api = backend(); api.state.profile = saved
    let finish!: (value: { data: typeof saved; error: null }) => void
    api.save.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    open(api.client)
    await screen.findByDisplayValue('Saved Owner')
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    fireEvent.click(screen.getByText('Resume page')); fireEvent.click(screen.getByText('Profile page'))
    expect((screen.getByLabelText('Full name (required)') as HTMLInputElement).disabled).toBe(true)
    await act(async () => finish({ data: saved, error: null }))
    expect((screen.getByLabelText('Full name (required)') as HTMLInputElement).disabled).toBe(false)
  })
  it('validates before saving and exposes field errors', async () => {
    const api = backend(); open(api.client)
    fireEvent.click(await screen.findByRole('button', { name: 'Save profile' }))
    expect(screen.getByText('Enter your full name.')).toBeTruthy()
    expect(screen.getByLabelText('Contact email (required)').getAttribute('aria-invalid')).toBe('true')
    expect(api.save).not.toHaveBeenCalled()
  })
  it('does not discard a draft if reload confirmation is declined', async () => {
    const api = backend(); open(api.client)
    fireEvent.change(await screen.findByLabelText('Full name (required)'), { target: { value: 'Keep me' } })
    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved profile' }))
    expect(screen.getByDisplayValue('Keep me')).toBeTruthy()
  })
  it('disables writes offline without discarding fields', async () => {
    const api = backend(); open(api.client)
    fireEvent.change(await screen.findByLabelText('Full name (required)'), { target: { value: 'Keep me' } })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => window.dispatchEvent(new Event('offline')))
    expect((screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByDisplayValue('Keep me')).toBeTruthy()
  })
  it('denies non-owner access without displaying editable forms', async () => {
    const api = backend(); api.state.owner = false; open(api.client)
    await screen.findByText('Owner access required')
    expect(screen.queryByLabelText('Full name (required)')).toBeNull()
  })
})

describe('private resume operations with mocked Supabase', () => {
  it('rejects non-PDF, empty and oversized files', () => {
    expect(validateResume(new File(['x'], 'x.pdf', { type: 'text/plain' }))).toContain('PDF')
    expect(validateResume(new File([], 'x.pdf', { type: 'application/pdf' }))).toContain('non-empty')
    expect(validateResume(new File([new Uint8Array(10485761)], 'x.pdf', { type: 'application/pdf' }))).toContain('10 MiB')
    expect(validateResume(pdf())).toBeNull()
  })
  it('uploads with a collision-resistant owner path and only finalizes after Storage success', async () => {
    const api = backend(); await uploadResume(api.client, ownerId, pdf())
    expect(api.upload.mock.calls[0][0]).toMatch(new RegExp(`^${ownerId}/[a-f0-9-]{36}\\.pdf$`))
    expect(api.rpc).toHaveBeenCalledWith('complete_resume', expect.any(Object))
  })
  it('does not upload if metadata creation is uncertain', async () => {
    const api = backend(); api.insert.mockRejectedValue(new Error())
    await expect(uploadResume(api.client, ownerId, pdf())).rejects.toThrow('metadata creation could not be confirmed')
    expect(api.upload).not.toHaveBeenCalled()
  })
  it('keeps an incomplete entry on ambiguous Storage failure without destructive cleanup', async () => {
    const api = backend(); api.upload.mockResolvedValue({ error: {} })
    await expect(uploadResume(api.client, ownerId, pdf())).rejects.toThrow('incomplete entry is retained')
    expect(api.removeRow).not.toHaveBeenCalled()
    expect(api.remove).not.toHaveBeenCalled()
    expect(api.rpc).not.toHaveBeenCalled()
  })
  it('reports uploaded-but-not-finalized data honestly', async () => {
    const api = backend(); api.rpc.mockRejectedValue(new Error())
    await expect(uploadResume(api.client, ownerId, pdf())).rejects.toThrow('completion could not be confirmed')
    await expect(completeResume(api.client, resume.id)).rejects.toThrow('Finish upload')
  })
  it('keeps metadata if Storage deletion fails', async () => {
    const api = backend(); api.remove.mockResolvedValue({ error: {} })
    await expect(deleteResume(api.client, resume)).rejects.toThrow('metadata was kept')
    expect(api.removeRow).not.toHaveBeenCalled()
  })
  it('reports partial deletion and permits an idempotent retry', async () => {
    const api = backend(); api.removeRow.mockResolvedValueOnce({ error: {}, data: null })
    await expect(deleteResume(api.client, resume)).rejects.toThrow('file may already be gone')
    await expect(deleteResume(api.client, resume)).resolves.toBeUndefined()
  })
  it('shows the server-confirmed default and preserves the previous selection on failure', async () => {
    const api = backend(); api.state.resumes = [resume]; open(api.client, '/resumes')
    fireEvent.click(await screen.findByRole('button', { name: 'Set resume.pdf as default' }))
    await screen.findByText('Default resume')
    api.rpc.mockRejectedValueOnce(new Error())
    await expect(setDefaultResume(api.client, 'another-id')).rejects.toThrow('Default selection could not be confirmed')
    expect(api.state.defaultId).toBe(resume.id)
  })
  it('requires deletion confirmation and disables mutations offline', async () => {
    const api = backend(); api.state.resumes = [resume]; open(api.client, '/resumes')
    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete resume.pdf' }))
    expect(api.remove).not.toHaveBeenCalled()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => window.dispatchEvent(new Event('offline')))
    expect((screen.getByRole('button', { name: 'Delete resume.pdf' }) as HTMLButtonElement).disabled).toBe(true)
    await expect(deleteResume(api.client, resume)).rejects.toThrow('offline')
  })
  it('uses authenticated blob download and releases temporary URLs', async () => {
    const api = backend(); api.state.resumes = [resume]
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:test'); static revokeObjectURL = vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const view = open(api.client, '/resumes')
    fireEvent.click(await screen.findByRole('button', { name: 'Download resume.pdf' }))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
    api.download.mockRejectedValue(new Error())
    await expect(downloadResume(api.client, resume)).rejects.toThrow('Download failed')
  })
})
