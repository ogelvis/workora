import { useCallback, useEffect, useState } from 'react'
import LandingPage from './LandingPage.jsx'
import AuthScreen from './AuthScreen.jsx'
import Workspace from './workspace/Workspace.jsx'
import Icon from './components/Icon.jsx'
import { ToastProvider } from './components/ui.jsx'
import { api } from './lib/api.js'

// Invite and reset links arrive as ?invite=… or ?reset=…; read them once, then clean the URL.
function readLinkToken() {
  const params = new URLSearchParams(window.location.search)
  for (const mode of ['invite', 'reset']) {
    const token = params.get(mode)
    if (token) return { mode, token }
  }
  return null
}

function Suspended({ account, onSignedOut }) {
  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } finally {
      onSignedOut()
    }
  }
  return (
    <div className="suspended">
      <div className="suspended-card">
        <span className="empty-icon"><Icon name="alert" size={22} /></span>
        <h1>{account.organization.name} is suspended</h1>
        <p>Access to this workspace has been paused, usually because of an outstanding payment. Your data is safe. Contact Workora support to restore access.</p>
        <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>Check again</button>
        <button type="button" className="btn btn-dark" onClick={logout}>Log out</button>
      </div>
    </div>
  )
}

function App() {
  const [linkToken] = useState(readLinkToken)
  const [account, setAccount] = useState(null)
  const [checking, setChecking] = useState(!linkToken)
  const [screen, setScreen] = useState(linkToken ? 'auth' : 'landing')
  const [authMode, setAuthMode] = useState(linkToken?.mode || 'login')

  useEffect(() => {
    if (linkToken) {
      window.history.replaceState(null, '', window.location.pathname)
      return
    }
    let active = true
    api('/api/auth/me')
      .then((data) => active && setAccount(data))
      .catch(() => {})
      .finally(() => active && setChecking(false))
    return () => {
      active = false
    }
  }, [linkToken])

  const authenticated = useCallback(async () => {
    // Fetch /me so the workspace also receives subscription details.
    setAccount(await api('/api/auth/me'))
  }, [])

  const signedOut = useCallback(() => {
    setAccount(null)
    setAuthMode('login')
    setScreen('auth')
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  function openAuth(mode) {
    setAuthMode(mode)
    setScreen('auth')
    window.scrollTo({ top: 0 })
  }

  if (checking) return <div className="boot" aria-label="Loading Workora"><span className="spinner" /></div>

  return (
    <ToastProvider>
      {account && account.subscription?.status === 'suspended' && !account.platformAdmin ? (
        <Suspended account={account} onSignedOut={signedOut} />
      ) : account ? (
        <Workspace account={account} setAccount={setAccount} onSignedOut={signedOut} />
      ) : screen === 'landing' ? (
        <LandingPage onGetStarted={() => openAuth('register')} onLogin={() => openAuth('login')} />
      ) : (
        <AuthScreen
          mode={authMode}
          setMode={setAuthMode}
          token={linkToken?.token}
          onAuthenticated={authenticated}
          onBack={() => setScreen('landing')}
        />
      )}
    </ToastProvider>
  )
}

export default App
