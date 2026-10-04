import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { BrandMark, Field, useToast } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { WorkspaceContext, readHash } from '../workspace/context.js'
import Admin from './Admin.jsx'
import './console.css'

// The owner's private sign-in. It is shown only when the server confirms the address
// is the secret path, and it accepts only platform-admin emails.
export function ConsoleLogin({ path, onSignedIn }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries())
      await api('/api/auth/console-login', { method: 'POST', body: { ...values, path } })
      await onSignedIn()
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="gate-brand"><BrandMark size={36} /><span>workora<small>CONTROL</small></span></div>
        <h1>Owner sign-in</h1>
        <p>Restricted access.</p>
        <Field label="Email"><input name="email" type="email" required autoComplete="username" autoFocus /></Field>
        <Field label="Password"><input name="password" type="password" required autoComplete="current-password" /></Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary gate-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
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
