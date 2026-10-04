import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { BrandMark, Field, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { WorkspaceContext, readHash } from '../workspace/context.js'
import Admin from './Admin.jsx'
import './console.css'

// The owner's private sign-in. It is shown only when the server confirms the address
// is the secret path. The first time, the owner chooses a password here; after that
// it is a normal sign-in that accepts only platform-admin emails.
export function ConsoleLogin({ path, onSignedIn }) {
  const [mode, setMode] = useState('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api('/api/auth/console-status', { method: 'POST', body: { path } })
      .then((status) => active && setMode(!status.configured ? 'unconfigured' : status.setupNeeded ? 'setup' : 'login'))
      .catch(() => active && setMode('login'))
    return () => {
      active = false
    }
  }, [path])

  async function submit(event) {
    event.preventDefault()
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    if (mode === 'setup' && values.password !== values.confirm) {
      setError('The two passwords don’t match.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'setup') {
        await api('/api/auth/console-setup', { method: 'POST', body: { fullName: values.fullName, email: values.email, password: values.password, path } })
      } else {
        await api('/api/auth/console-login', { method: 'POST', body: { email: values.email, password: values.password, path } })
      }
      await onSignedIn()
    } catch (requestError) {
      if (requestError.code === 'exists') setMode('login')
      setError(requestError.message)
      setBusy(false)
    }
  }

  const brand = <div className="gate-brand"><BrandMark size={36} /><span>workora<small>CONTROL</small></span></div>

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

  const setup = mode === 'setup'
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit} key={mode}>
        {brand}
        <h1>{setup ? 'Set up owner access' : 'Owner sign-in'}</h1>
        <p>{setup ? 'First time here: choose the password you’ll use to control Workora.' : 'Restricted access.'}</p>
        {setup && <Field label="Your name"><input name="fullName" required minLength={2} autoComplete="name" autoFocus /></Field>}
        <Field label="Owner email"><input name="email" type="email" required autoComplete="username" autoFocus={!setup} /></Field>
        <Field label="Password" hint={setup ? 'At least 12 characters.' : undefined}>
          <input name="password" type="password" required minLength={setup ? 12 : 1} autoComplete={setup ? 'new-password' : 'current-password'} />
        </Field>
        {setup && <Field label="Confirm password"><input name="confirm" type="password" required minLength={12} autoComplete="new-password" /></Field>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary gate-submit" disabled={busy}>
          {busy ? (setup ? 'Setting up…' : 'Signing in…') : (setup ? 'Create owner access' : 'Sign in')}
        </button>
      </form>
    </div>
  )
}

// Full-screen console for a platform-admin session, separate from any workspace.
export function ConsoleApp({ account, onSignedOut }) {
  const toast = useToast()
  const [route, setRoute] = useState(readHash)

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Admin.jsx asks to navigate to "admin" with a tab; the console only tracks the tab.
  const navigate = useCallback((_view, params = {}) => {
    const query = new URLSearchParams(params).toString()
    window.location.hash = `/${query ? `?${query}` : ''}`
  }, [])

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } finally {
      onSignedOut()
    }
  }

  const context = useMemo(() => ({ account, toast, navigate, params: route.params }), [account, toast, navigate, route.params])

  return (
    <WorkspaceContext.Provider value={context}>
      <div className="console">
        <header className="console-bar">
          <div className="console-brand"><BrandMark size={30} /><span>workora<small>CONTROL</small></span></div>
          <div className="console-user">
            <span className="console-session"><Icon name="shield" size={14} />Owner session · expires in 12 h</span>
            <strong>{account.user.fullName}</strong>
            <button type="button" className="btn btn-sm" onClick={logout}><Icon name="logout" size={15} />Sign out</button>
          </div>
        </header>
        <main className="console-content">
          <Admin />
        </main>
      </div>
    </WorkspaceContext.Provider>
  )
}
