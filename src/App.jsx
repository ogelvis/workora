import { useCallback, useEffect, useState } from 'react'
import LandingPage from './LandingPage.jsx'
import AuthScreen from './AuthScreen.jsx'
import Workspace from './workspace/Workspace.jsx'
import { ConsoleApp, ConsoleLogin } from './console/Console.jsx'
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

// Any address other than "/" might be the owner's private sign-in; only the server knows.
function readEntryPath() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '')
  return path && path !== 'index.html' ? path : null
}

function App() {
  const [linkToken] = useState(readLinkToken)
  const [entryPath] = useState(readEntryPath)
  const [account, setAccount] = useState(null)
  const [gateway, setGateway] = useState(false)
  const [checking, setChecking] = useState(!linkToken)
  const [screen, setScreen] = useState(linkToken ? 'auth' : 'landing')
  const [authMode, setAuthMode] = useState(linkToken?.mode || 'login')

  useEffect(() => {
    if (linkToken) {
      window.history.replaceState(null, '', window.location.pathname)
      return
    }
    let active = true
    const gatewayCheck = entryPath
      ? api(`/api/auth/gateway/${encodeURIComponent(entryPath)}`).then(() => true).catch(() => false)
      : Promise.resolve(false)
    Promise.all([api('/api/auth/me').catch(() => null), gatewayCheck])
      .then(([me, isGateway]) => {
        if (!active) return
        setAccount(me)
        setGateway(isGateway)
        // Unknown addresses quietly become the homepage.
        if (entryPath && !isGateway) window.history.replaceState(null, '', '/')
      })
      .finally(() => active && setChecking(false))
    return () => {
      active = false
    }
  }, [linkToken, entryPath])

  const authenticated = useCallback(async () => {
    // Fetch /me so the workspace also receives subscription details.
    setAccount(await api('/api/auth/me'))
  }, [])

  const signedOut = useCallback(() => {
    // Leaving the console returns to the private sign-in; leaving a workspace to the login page.
    const fromConsole = Boolean(account?.platformAdmin)
    setAccount(null)
    setAuthMode('login')
    setScreen(fromConsole ? 'landing' : 'auth')
    window.history.replaceState(null, '', fromConsole ? window.location.pathname : '/')
  }, [account])

  function openAuth(mode) {
    setAuthMode(mode)
    setScreen('auth')
    window.scrollTo({ top: 0 })
  }

  if (checking) return <div className="boot" aria-label="Loading Workora"><span className="spinner" /></div>

  return (
    <ToastProvider>
      {account?.platformAdmin ? (
        <ConsoleApp account={account} onSignedOut={signedOut} />
      ) : gateway ? (
        <ConsoleLogin path={entryPath} onSignedIn={authenticated} />
      ) : account && account.subscription?.status === 'suspended' ? (
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
