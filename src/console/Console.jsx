import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Avatar, BrandMark, Field, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { WorkspaceContext, readHash } from '../workspace/context.js'
import {
  AccountSection, AddPartner, AuditSection, OverviewSection, PlansSection, SystemSection, UsersSection, WorkspacesSection,
} from './Admin.jsx'
import './console.css'

// A reset link arrives as /<private path>#reset=<token>; read it once and clear it from the address bar.
function readResetToken() {
  const match = window.location.hash.match(/^#reset=([A-Za-z0-9_-]{20,200})$/)
  if (!match) return null
  window.history.replaceState(null, '', window.location.pathname)
  return match[1]
}

// The owner's private sign-in. It is shown only when the server confirms the address is
// the secret path. First visit: choose a password. Later: sign in, or recover by email.
export function ConsoleLogin({ path, onSignedIn }) {
  const [resetToken] = useState(readResetToken)
  const [mode, setMode] = useState(resetToken ? 'reset' : 'loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')

  useEffect(() => {
    if (resetToken) return undefined
    let active = true
    api('/api/auth/console-status', { method: 'POST', body: { path } })
      .then((status) => active && setMode(!status.configured ? 'unconfigured' : status.setupNeeded ? 'setup' : 'login'))
      .catch(() => active && setMode('login'))
    return () => {
      active = false
    }
  }, [path, resetToken])

  function go(next) {
    setError('')
    setMode(next)
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    if (['setup', 'reset'].includes(mode) && values.password !== values.confirm) {
      setError('The two passwords don’t match.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'setup') {
        await api('/api/auth/console-setup', { method: 'POST', body: { fullName: values.fullName, email: values.email, password: values.password, path } })
        await onSignedIn()
      } else if (mode === 'reset') {
        await api('/api/auth/console-reset', { method: 'POST', body: { token: resetToken, password: values.password, path } })
        await onSignedIn()
      } else if (mode === 'forgot') {
        const result = await api('/api/auth/console-forgot', { method: 'POST', body: { email: values.email, path } })
        setSentTo(values.email)
        setMode(result.emailConfigured ? 'sent' : 'manual')
        setBusy(false)
      } else {
        await api('/api/auth/console-login', { method: 'POST', body: { email: values.email, password: values.password, path } })
        await onSignedIn()
      }
    } catch (requestError) {
      if (requestError.code === 'exists') setMode('login')
      setError(requestError.message)
      setBusy(false)
    }
  }

  const brand = <div className="gate-brand"><BrandMark size={34} label="OVO" /><span><small>CONTROL</small></span></div>

  if (mode === 'loading') {
    return <div className="gate"><span className="spinner" aria-label="Loading" /></div>
  }

  if (mode === 'unconfigured') {
    return (
      <div className="gate">
        <div className="gate-card">
          {brand}
          <h1>Owner access is off</h1>
          <p className="gate-note">
            No owner email is set. In Vercel, open <strong>Settings → Environment Variables</strong>, set
            <code>PLATFORM_ADMIN_EMAILS</code> to your email for <strong>Production</strong>, then redeploy.
          </p>
        </div>
      </div>
    )
  }

  if (mode === 'sent' || mode === 'manual') {
    return (
      <div className="gate">
        <div className="gate-card">
          {brand}
          {mode === 'sent' ? <>
            <span className="gate-icon"><Icon name="mail" size={22} /></span>
            <h1>Check your email</h1>
            <p className="gate-note">If <strong>{sentTo}</strong> is an owner address, a link to choose a new password is on its way. It works once and expires in 1 hour. Check spam if you don’t see it.</p>
          </> : <>
            <span className="gate-icon warn"><Icon name="alert" size={22} /></span>
            <h1>Email isn’t set up yet</h1>
            <p className="gate-note">OVO can’t send the reset email until email sending is configured. You can still reset your password from your computer, inside the Workora folder:</p>
            <pre className="gate-code">set "DATABASE_URL=your-production-connection-string" && npm run owner:password -- {sentTo || 'you@example.com'} "YourNewPassword123"</pre>
            <p className="gate-note">Use the Production <code>DATABASE_URL</code> from Vercel and a password of at least 12 characters.</p>
          </>}
          <button type="button" className="btn gate-submit" onClick={() => go('login')}><Icon name="left" size={15} />Back to sign in</button>
        </div>
      </div>
    )
  }

  const titles = {
    setup: ['Set up owner access', 'First time here: choose the password you’ll use to control OVO.', 'Create owner access'],
    login: ['Owner sign-in', 'Restricted access.', 'Sign in'],
    forgot: ['Forgot your password?', 'Enter your owner email and we’ll send you a link to choose a new one.', 'Send reset link'],
    reset: ['Choose a new password', 'At least 12 characters. You’ll be signed in straight away.', 'Save and sign in'],
  }
  const [title, lede, action] = titles[mode]
  const newPassword = mode === 'setup' || mode === 'reset'

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit} key={mode}>
        {brand}
        <h1>{title}</h1>
        <p>{lede}</p>
        {mode === 'setup' && <Field label="Your name"><input name="fullName" required minLength={2} autoComplete="name" autoFocus /></Field>}
        {mode !== 'reset' && <Field label="Owner email"><input name="email" type="email" required autoComplete="username" autoFocus={mode !== 'setup'} /></Field>}
        {mode !== 'forgot' && (
          <Field label={newPassword ? 'New password' : 'Password'} hint={newPassword ? 'At least 12 characters.' : undefined}>
            <input name="password" type="password" required minLength={newPassword ? 12 : 1} autoComplete={newPassword ? 'new-password' : 'current-password'} autoFocus={mode === 'reset'} />
          </Field>
        )}
        {newPassword && <Field label="Confirm password"><input name="confirm" type="password" required minLength={12} autoComplete="new-password" /></Field>}
        {mode === 'login' && <button type="button" className="gate-link" onClick={() => go('forgot')}>Forgot password?</button>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary gate-submit" disabled={busy}>{busy ? 'Please wait…' : action}</button>
        {mode === 'forgot' && <button type="button" className="gate-link center" onClick={() => go('login')}>Back to sign in</button>}
        {mode === 'reset' && error && <button type="button" className="gate-link center" onClick={() => go('forgot')}>Request a new link</button>}
      </form>
    </div>
  )
}

const SECTIONS = [
  { group: '', items: [
    { key: 'overview', label: 'Overview', icon: 'home', tone: 'violet' },
  ] },
  { group: 'Customers', items: [
    { key: 'workspaces', label: 'Workspaces', icon: 'building', tone: 'blue' },
    { key: 'partners', label: 'Partners', icon: 'deal', tone: 'pink' },
    { key: 'users', label: 'People', icon: 'team', tone: 'teal' },
  ] },
  { group: 'Business', items: [
    { key: 'plans', label: 'Plans & pricing', icon: 'billing', tone: 'amber' },
    { key: 'audit', label: 'Audit log', icon: 'list', tone: 'slate' },
  ] },
  { group: 'Settings', items: [
    { key: 'account', label: 'Account & security', icon: 'key', tone: 'indigo' },
    { key: 'system', label: 'System status', icon: 'settings', tone: 'green' },
  ] },
]
const KEYS = SECTIONS.flatMap((group) => group.items.map((item) => item.key))

// Full-screen console for a platform-admin session, separate from any workspace.
export function ConsoleApp({ account, onSignedOut }) {
  const toast = useToast()
  const [route, setRoute] = useState(readHash)
  const [navOpen, setNavOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const section = KEYS.includes(route.params.tab) ? route.params.tab : 'overview'

  useEffect(() => {
    const onHash = () => {
      setRoute(readHash())
      setNavOpen(false)
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Sections navigate by tab; extra params (like a status filter) ride along.
  const navigate = useCallback((_view, params = {}) => {
    const query = new URLSearchParams(params).toString()
    window.location.hash = `/${query ? `?${query}` : ''}`
  }, [])
  const go = useCallback((tab, extra = {}) => navigate('admin', { tab, ...extra }), [navigate])

  // A console session that ends (after 30 days, or signed out elsewhere) returns to the sign-in.
  const expired = useCallback(() => {
    toast('Your owner session has ended. Please sign in again.', 'error')
    onSignedOut()
  }, [toast, onSignedOut])

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } finally {
      onSignedOut()
    }
  }

  const context = useMemo(
    () => ({ account, toast, navigate, expired, params: route.params }),
    [account, toast, navigate, expired, route.params],
  )
  const current = SECTIONS.flatMap((group) => group.items).find((item) => item.key === section)
  const addPartner = () => setAdding(true)

  return (
    <WorkspaceContext.Provider value={context}>
      <div className={`cx${navOpen ? ' nav-open' : ''}`}>
        <aside className="cx-side" aria-label="Console navigation">
          <div className="cx-brand">
            <BrandMark size={26} label="OVO" white />
            <span>CONTROL</span>
            <button type="button" className="cx-close" aria-label="Close menu" onClick={() => setNavOpen(false)}><Icon name="close" size={18} /></button>
          </div>
          <nav className="cx-nav">
            {SECTIONS.map((group) => (
              <div key={group.group || 'main'} className="cx-nav-group">
                {group.group && <span className="cx-nav-label">{group.group}</span>}
                {group.items.map((item) => (
                  <a key={item.key} href={`#/?tab=${item.key}`} className={section === item.key ? 'active' : ''} aria-current={section === item.key ? 'page' : undefined}>
                    <span className={`nav-icon tone-${item.tone}`}><Icon name={item.icon} size={15} /></span>
                    {item.label}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <button type="button" className="cx-add" onClick={addPartner}><Icon name="plus" size={16} />Add partner business</button>
          <div className="cx-me">
            <Avatar name={account.user.fullName} size="sm" />
            <div><strong>{account.user.fullName}</strong><small>Owner · stays signed in 30 days</small></div>
            <button type="button" className="cx-logout" aria-label="Sign out" title="Sign out" onClick={logout}><Icon name="logout" size={17} /></button>
          </div>
        </aside>
        <button type="button" className="cx-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />

        <div className="cx-main">
          <header className="cx-top">
            <button type="button" className="cx-menu" aria-label="Open menu" onClick={() => setNavOpen(true)}><Icon name="menu" size={20} /></button>
            <div className="cx-crumbs"><span>OVO Control</span><Icon name="right" size={13} /><strong>{current?.label}</strong></div>
            <span className="cx-badge"><Icon name="shield" size={14} />Platform owner</span>
          </header>
          <main className="cx-content" key={section}>
            {section === 'overview' && <OverviewSection go={go} onAddPartner={addPartner} />}
            {section === 'workspaces' && <WorkspacesSection onAddPartner={addPartner} refreshKey={refreshKey} />}
            {section === 'partners' && <WorkspacesSection partnersOnly onAddPartner={addPartner} refreshKey={refreshKey} />}
            {section === 'users' && <UsersSection />}
            {section === 'plans' && <PlansSection />}
            {section === 'audit' && <AuditSection />}
            {section === 'account' && <AccountSection />}
            {section === 'system' && <SystemSection />}
          </main>
        </div>
      </div>
      {adding && <AddPartnerLoader onClose={() => setAdding(false)} onCreated={() => setRefreshKey((key) => key + 1)} />}
    </WorkspaceContext.Provider>
  )
}

// The partner form needs the plan list; load it before opening.
function AddPartnerLoader({ onClose, onCreated }) {
  const [plans, setPlans] = useState(null)
  useEffect(() => {
    api('/api/admin/plans').then((result) => setPlans(result.plans)).catch(() => setPlans([]))
  }, [])
  if (!plans) return null
  return <AddPartner plans={plans} onClose={onClose} onCreated={onCreated} />
}
