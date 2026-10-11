import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { ArrowRight, BriefcaseBusiness, Check, Circle, LayoutDashboard, LogOut, Send, Settings, Sprout } from 'lucide-react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { setupError, supabase } from './lib/supabase'
import { useAuth } from './auth/useAuth'
import { signInError } from './auth/errors'
import { loginDestination } from './auth/routing'
import { WorkspaceProvider } from './workspace/WorkspaceContext'
import { useWorkspace, useOnline } from './workspace/useWorkspace'
import { ProfilePage } from './workspace/ProfilePage'
import { ResumesPage } from './workspace/ResumesPage'
import { DiscoveryProvider } from './workspace/DiscoveryProvider'
import { useDiscovery } from './workspace/useDiscovery'
import { JobsPage } from './workspace/JobsPage'
import { SourceSettings } from './workspace/SourceSettings'
import { gmailStatus } from './lib/discovery'
import './App.css'

function Brand() {
  return <span className="brand"><Sprout aria-hidden="true" size={28} />JobPilot<span className="brand-dot">.</span></span>
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="centered"><div className="entry-panel"><Brand />{children}</div></main>
}

function SetupError({ message }: { message: string }) {
  return <Centered><h1>Let’s connect your workspace.</h1><p role="alert" className="error-message">{message}</p>
    <p>Copy <code>.env.example</code> to <code>.env.local</code> and add the project URL and publishable key from Supabase. Restart the development server after saving.</p>
    <p>For Vercel, set both environment variables and rebuild. See the README for setup steps.</p>
    <button className="button" onClick={() => window.location.reload()}>Check again</button>
  </Centered>
}

function Login({ client, notice }: { client: SupabaseClient; notice: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invalid, setInvalid] = useState<'email' | 'password' | null>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const submitting = useRef(false)
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    setError(null)
    setInvalid(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setInvalid('email'); setError('Enter a valid email address.'); return
    }
    if (!password) { setInvalid('password'); setError('Enter your password.'); return }
    submitting.current = true
    setBusy(true)
    try {
      const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) setError(signInError(authError))
    } catch {
      setError('Unable to reach Supabase. Check your connection and try again.')
    } finally {
      setPassword('')
      setBusy(false)
      submitting.current = false
    }
  }

  return <Centered>
    <h1>Your next chapter starts here.</h1>
    <p>Sign in to your personal job-search workspace.</p>
    {notice && <p className="notice" role="status">{notice}</p>}
    <form onSubmit={submit} noValidate aria-busy={busy}>
      <div className="field"><label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email}
          onChange={event => setEmail(event.target.value)} aria-invalid={invalid === 'email'} aria-describedby={invalid === 'email' ? 'login-error' : undefined} disabled={busy} /></div>
      <div className="field"><label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required value={password}
          onChange={event => setPassword(event.target.value)} aria-invalid={invalid === 'password'} aria-describedby={invalid === 'password' ? 'login-error' : undefined} disabled={busy} /></div>
      {error && <p className="error-message" id="login-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      <button className="button full-width" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={18} aria-hidden="true" /></button>
      <span className="sr-only" role="status">{busy ? 'Signing in. Please wait.' : ''}</span>
    </form>
    <p className="fine-print">Use your pre-created Supabase account. Public registration is not available in JobPilot.</p>
  </Centered>
}

const navigation = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/jobs', label: 'Jobs', icon: BriefcaseBusiness },
  { to: '/applications', label: 'Applications', icon: Send },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return <nav className={mobile ? 'mobile-nav' : 'sidebar-nav'} aria-label={mobile ? 'Mobile navigation' : 'Main navigation'}>
    {navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to}><Icon size={21} aria-hidden="true" /><span>{label}</span></NavLink>)}
  </nav>
}

function Shell({ session }: { session: Session }) {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    document.title = `${navigation.find(item => item.to === pathname)?.label ?? (pathname === '/profile' ? 'Profile' : pathname === '/resumes' ? 'Resumes' : 'Page not found')} · JobPilot`
    mainRef.current?.focus()
    window.scrollTo(0, 0)
  }, [pathname])
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar"><Link className="brand-link" to="/dashboard" aria-label="JobPilot dashboard"><Brand /></Link>
      <Navigation /><div className="sidebar-footer"><span className="account-avatar" aria-hidden="true">{(session.user.email ?? 'A').slice(0, 1).toUpperCase()}</span>
        <div><strong>Personal workspace</strong><span className="account-email">{session.user.email ?? 'Signed-in account'}</span></div></div>
    </aside>
    <header className="mobile-header"><Link className="brand-link" to="/dashboard" aria-label="JobPilot dashboard"><Brand /></Link><span className="muted">Personal workspace</span></header>
    <main className="main-content" id="main-content" ref={mainRef} tabIndex={-1}><Outlet /></main>
    <Navigation mobile />
  </div>
}

function PageHeading({ title, children }: { title: string; children: ReactNode }) {
  return <header className="page-heading"><h1>{title}</h1><p>{children}</p></header>
}

const checklist = [
  { title: 'Account sign-in', detail: 'Your Supabase account is signed in.', status: 'Ready', ready: true },
  { title: 'Personal workspace', detail: 'Dashboard, jobs, applications, and settings are in place.', status: 'Ready', ready: true },
  { title: 'Scheduled automation', detail: 'No scheduled workers or background runs exist yet.', status: 'Not implemented', ready: false },
]

function Dashboard({ session }: { session: Session }) {
  const { data, loading, error, refresh, online, dirty } = useWorkspace()
  const discovery = useDiscovery()
  const discoveryUnknown = discovery.error ? 'Unavailable' : !data?.owner ? 'Owner setup needed' : !discovery.data ? 'Checking…' : null
  const sourceCount = discovery.data?.sources.filter(source => source.kind !== 'manual' && source.enabled).length ?? 0
  const unknown = loading ? 'Checking…' : error ? 'Unavailable' : !data?.owner ? 'Owner setup needed' : null
  const persisted = [
    { title: 'Owner profile', detail: data?.profile ? 'A profile is saved. Review details and preferences in Profile.' : 'Add your contact details, experience, and preferences in Profile.', status: unknown ?? (data?.profile ? 'Saved' : 'Not saved'), ready: !unknown && !!data?.profile },
    { title: 'Private resume', detail: 'Upload a private PDF and choose a default in Resumes.', status: unknown ?? (data?.defaultId ? 'Default selected' : data?.resumes.some(item => item.status === 'ready') ? 'Choose a default' : 'No ready resume'), ready: !unknown && !!data?.defaultId },
    { title: 'Job sources', detail: 'Manage Gmail labels and Greenhouse boards in Settings. Import on demand from Jobs.', status: discoveryUnknown ?? `${sourceCount} enabled`, ready: !discoveryUnknown && sourceCount > 0 },
    { title: 'Gmail connection', detail: 'Read-only access for your chosen label. Check Gmail access in Settings to verify with Google.', status: discoveryUnknown ?? gmailStatus(discovery.data?.connection ?? null), ready: !discoveryUnknown && discovery.data?.connection?.status === 'connected' },
  ]
  return <><PageHeading title="Welcome to your workspace.">A little structure for your next career move.</PageHeading>
    <div className="welcome-note"><span className="status-dot" aria-hidden="true" /><p>Signed in as <strong className="wrap-anywhere">{session.user.email ?? 'your Supabase account'}</strong></p></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <section className="panel" aria-labelledby="setup-heading"><div className="section-heading"><div><h2 id="setup-heading">Your setup checklist</h2><p>Status reflects your saved workspace data.</p></div><span className="badge">Phase 3</span></div>
      <ul className="checklist">{[...checklist.slice(0, 2), ...persisted, ...checklist.slice(2)].map(item => <li key={item.title}>
        <span className={item.ready ? 'check-icon ready' : 'check-icon'}>{item.ready ? <Check size={19} aria-hidden="true" /> : <Circle size={19} aria-hidden="true" />}</span>
        <div className="check-copy"><h3>{item.title}</h3><p>{item.detail}</p></div><span className={item.ready ? 'badge badge-ready' : 'badge'}>{item.status}</span>
      </li>)}</ul>
    </section>
    <section className="next-step" aria-labelledby="next-heading"><h2 id="next-heading">Explore jobs against your preferences</h2><p>Save your profile, import opportunities, and review the evidence behind each match. Applications arrive in Phase 4. {dirty ? 'You have unsaved profile changes.' : ''}</p><div className="action-row"><Link className="text-link" to="/jobs">Browse jobs</Link><Link className="text-link" to="/profile">Edit profile <ArrowRight size={18} aria-hidden="true" /></Link><Link className="text-link" to="/resumes">Manage resumes</Link><button className="button button-secondary" disabled={loading || discovery.loading || !online} onClick={() => { void refresh(); void discovery.refresh() }}>Refresh status</button></div></section>
  </>
}

function EmptyPage() {
  return <><PageHeading title="Applications">Keep your job-search progress in one place.</PageHeading>
    <section className="panel empty-state"><Send size={38} strokeWidth={1.5} aria-hidden="true" /><h2>No applications have been sent.</h2>
      <p>Application preparation, sending, and tracking are coming in Phase 4. JobPilot cannot send emails yet.</p>
      <Link className="text-link" to="/dashboard">View setup checklist <ArrowRight size={18} aria-hidden="true" /></Link>
    </section></>
}

function SettingsPage({ session, client }: { session: Session; client: SupabaseClient }) {
  const { dirty } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function signOut() {
    if (busy || (dirty && !window.confirm('Sign out and discard unsaved profile changes?'))) return
    setBusy(true); setError(null)
    try {
      const { error: authError } = await client.auth.signOut({ scope: 'local' })
      if (authError) setError('Sign-out could not finish. Check your connection and try again.')
    } catch { setError('Sign-out could not finish. Check your connection and try again.') }
    finally { setBusy(false) }
  }
  return <><PageHeading title="Settings">Your account and workspace connections.</PageHeading>
    <SourceSettings />
    <section className="panel settings-section"><h2>Your application details</h2><p>Manage your saved background and private PDFs. {dirty ? 'Your profile has unsaved changes.' : ''}</p><div className="action-row"><Link className="text-link" to="/profile">Profile</Link><Link className="text-link" to="/resumes">Resumes</Link></div></section>
    <section className="panel settings-section"><h2>Install on your phone</h2><p><strong>Android:</strong> Open your deployed HTTPS site in Chrome. Open the browser menu, then choose “Install app” or “Add to Home screen”.</p><p><strong>iPhone:</strong> Open the site in Safari. Tap Share, then “Add to Home Screen” and Add. Enable “Open as Web App” if offered.</p><p className="fine-print">Installation availability depends on your browser. Sign in on each device. Only the public app shell works offline; private data needs a connection. Installation does not enable background job automation.</p></section>
    <section className="panel settings-section" aria-labelledby="account-heading"><h2 id="account-heading">Account</h2><p className="muted">Signed in with email and password</p><p className="account-value">{session.user.email ?? 'Email unavailable'}</p>
      <button className="button button-secondary" onClick={signOut} disabled={busy}><LogOut size={18} aria-hidden="true" />{busy ? 'Signing out…' : 'Sign out'}</button>
      <p className="fine-print">Signs out of this browser session.</p>{error && <p className="error-message" role="alert">{error}</p>}
    </section>
    <section className="panel settings-section" aria-labelledby="connections-heading"><h2 id="connections-heading">Connections & automation</h2>
      <div className="setting-row"><Circle size={22} aria-hidden="true" /><div><h3>Automation</h3><p>No scheduled tasks run in the background.</p></div><span className="badge">Not implemented</span></div>
    </section></>
}

function NotFound({ signedIn }: { signedIn: boolean }) {
  useEffect(() => { document.title = 'Page not found · JobPilot' }, [])
  return <Centered><h1>Page not found</h1><p>This address doesn’t belong to a JobPilot page.</p><Link className="button" to={signedIn ? '/dashboard' : '/login'}>{signedIn ? 'Back to dashboard' : 'Go to sign in'}</Link></Centered>
}

function Protected({ session, client }: { session: Session | null; client: SupabaseClient }) {
  const location = useLocation()
  return session ? <WorkspaceProvider key={session.user.id} ownerId={session.user.id} client={client}><DiscoveryProvider><Shell session={session} /></DiscoveryProvider></WorkspaceProvider> : <Navigate to="/login" state={{ from: location.pathname }} replace />
}

function AuthenticatedApp({ client }: { client: SupabaseClient }) {
  const auth = useAuth(client)
  const location = useLocation()
  useEffect(() => {
    if (!auth.session && location.pathname === '/login') document.title = 'Sign in · JobPilot'
  }, [auth.session, location.pathname])
  if (auth.loading) return <Centered><h1>Opening your workspace…</h1><p role="status">Restoring your session. Please wait.</p></Centered>
  if (auth.error) return <Centered><h1>We couldn’t open your workspace.</h1><p className="error-message" role="alert">{auth.error}</p><button className="button" onClick={() => window.location.reload()}>Try again</button></Centered>
  return <Routes>
    <Route path="/" element={<Navigate to={auth.session ? '/dashboard' : '/login'} replace />} />
    <Route path="/login" element={auth.session ? <Navigate to={loginDestination(location.state)} replace /> : <Login client={client} notice={auth.notice} />} />
    <Route element={<Protected session={auth.session} client={client} />}>
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/resumes" element={<ResumesPage />} />
      <Route path="/dashboard" element={auth.session && <Dashboard session={auth.session} />} />
      <Route path="/jobs" element={<JobsPage />} />
      <Route path="/applications" element={<EmptyPage />} />
      <Route path="/settings" element={auth.session && <SettingsPage key={auth.session.user.id} session={auth.session} client={client} />} />
    </Route>
    <Route path="*" element={<NotFound signedIn={!!auth.session} />} />
  </Routes>
}

export default function App() {
  const online = useOnline()
  if (!supabase) return <SetupError message={setupError ?? 'Supabase is not configured.'} />
  return <><div className="connection-banner" role="status" hidden={online}>You’re offline. Private data cannot be refreshed. Saving, uploads, downloads, and deletion are disabled. Unsaved entries remain in memory until you close or sign out.</div><BrowserRouter><AuthenticatedApp client={supabase} /></BrowserRouter></>
}

