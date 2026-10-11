import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { completeResume, deleteResume, downloadResume, setDefaultResume, uploadResume, validateResume, workspaceMessage, type Resume } from '../lib/workspace'
import { OwnerContent } from './WorkspaceContext'
import { useWorkspace } from './useWorkspace'

export function ResumesPage() {
  return <><header className="page-heading"><h1>Resumes</h1><p>Private PDFs, available only to your registered owner account.</p><Link className="text-link" to="/settings">Back to settings</Link></header>
    <OwnerContent><ResumeManager /></OwnerContent></>
}
function ResumeManager() {
  const { client, ownerId, data, refresh, loading, online } = useWorkspace()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const locked = useRef(false)
  const urls = useRef(new Set<string>())
  useEffect(() => {
    const current = urls.current
    return () => { for (const url of current) URL.revokeObjectURL(url); current.clear() }
  }, [])
  async function perform(action: () => Promise<void>, success: string) {
    if (locked.current || !online) return
    locked.current = true; setBusy(true); setError(null); setNotice('')
    try {
      await action()
      const refreshed = await refresh()
      setNotice(refreshed ? success : `${success} The list could not be refreshed; it may be out of date. Retry refreshing before another change.`)
    } catch (reason) { setError(workspaceMessage(reason)); await refresh() }
    finally { locked.current = false; setBusy(false) }
  }
  async function download(resume: Resume) {
    if (locked.current || !online) return
    locked.current = true; setBusy(true); setError(null); setNotice('')
    try {
      const blob = await downloadResume(client, resume)
      const url = URL.createObjectURL(blob)
      urls.current.add(url)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = resume.original_name; document.body.append(anchor); anchor.click(); anchor.remove()
      window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url) }, 1000)
      setNotice('Download handed to your browser. Check its downloads to confirm the file was saved.')
    } catch (reason) { setError(workspaceMessage(reason)) }
    finally { locked.current = false; setBusy(false) }
  }
  return <>
    <section className="panel settings-section" aria-labelledby="upload-heading"><h2 id="upload-heading">Upload a resume</h2>
      <p className="muted">PDF only, up to 10 MiB. Files are not parsed, sent to AI, or scanned for malware. File-type checks are not a security scan.</p>
      <form onSubmit={event => { event.preventDefault(); if (file) void perform(async () => {
        await uploadResume(client, ownerId, file); setFile(null); if (input.current) input.current.value = ''
      }, 'Resume uploaded.') }}>
        <div className="field"><label htmlFor="resume-file">PDF file</label><input id="resume-file" name="resume-file" type="file" accept="application/pdf,.pdf" ref={input} disabled={busy || !online}
          onChange={event => { const selected = event.target.files?.[0] ?? null; setFile(selected); setError(selected ? validateResume(selected) : null); setNotice('') }} /></div>
        <button className="button" disabled={busy || !online || !file || !!validateResume(file)}>{busy ? 'Working…' : 'Upload PDF'}</button>
      </form>
    </section>
    {error && <p className="error-message" role="alert">{error}</p>}
    <p role="status">{busy ? 'Resume operation in progress…' : notice}</p>
    <section className="panel settings-section" aria-labelledby="resume-list-heading"><div className="section-heading compact"><h2 id="resume-list-heading">Your resumes</h2>
      <button className="button button-secondary" disabled={busy || loading || !online} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh list'}</button></div>
      {!data?.resumes.length ? <p>No resumes uploaded yet. Upload a PDF, then choose a default when you are ready.</p> : <ul className="resume-list">{data.resumes.map(resume => <li key={resume.id}>
        <div className="resume-title"><h3>{resume.original_name}</h3><span className="badge">{resume.status === 'pending' ? 'Incomplete upload' : data.defaultId === resume.id ? 'Default resume' : 'Ready'}</span></div>
        <p className="fine-print">{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(resume.byte_size / (resume.byte_size < 1048576 ? 1024 : 1048576))} {resume.byte_size < 1048576 ? 'KiB' : 'MiB'} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(resume.created_at))}</p>
        {resume.status === 'pending' && <p className="fine-print">If the PDF reached Storage, finish the upload. Otherwise delete this entry and upload again. No file is marked ready until both steps are confirmed.</p>}
        <div className="action-row">
          {resume.status === 'ready' ? <><button className="button button-secondary" disabled={busy || !online} onClick={() => void download(resume)} aria-label={`Download ${resume.original_name}`}>Download</button>
            <button className="button button-secondary" disabled={busy || !online || data.defaultId === resume.id} onClick={() => void perform(() => setDefaultResume(client, resume.id), 'Default resume saved.')} aria-label={`Set ${resume.original_name} as default`}>Set default</button></>
            : <button className="button button-secondary" disabled={busy || !online} onClick={() => void perform(() => completeResume(client, resume.id), 'Upload completed.')}>Finish upload</button>}
          <button className="button button-secondary danger" disabled={busy || !online} aria-label={`Delete ${resume.original_name}`} onClick={() => {
            if (window.confirm(`Delete “${resume.original_name}” and its private file? This cannot be undone.${data.defaultId === resume.id ? ' Your default selection will be cleared.' : ''}`)) void perform(() => deleteResume(client, resume), 'Resume and file deleted.')
          }}>Delete</button>
        </div>
      </li>)}</ul>}
    </section>
  </>
}
