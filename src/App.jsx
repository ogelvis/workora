import { useCallback, useEffect, useRef, useState } from 'react'
import LandingPage from './LandingPage.jsx'
import AuthScreen from './AuthScreen.jsx'
import Workspace from './workspace/Workspace.jsx'
import { ConsoleApp, ConsoleLogin } from './console/Console.jsx'
import Icon from './components/Icon.jsx'
import { ToastProvider } from './components/ui.jsx'
import { api } from './lib/api.js'
import PublicForm from './public/PublicForm.jsx'
import PublicShare from './public/PublicShare.jsx'

// Invite, reset and partner welcome links arrive as ?invite=…, ?reset=… or ?welcome=…;
// read them once, then clean the URL.
function readLinkToken() {
  const params = new URLSearchParams(window.location.search)
  for (const mode of ['invite', 'reset', 'welcome']) {
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
        <p>Access to this workspace has been paused, usually because of an outstanding payment. Your data is safe. Contact OVO support to restore access.</p>
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

// A partner's emailed link: sign them in and open their dashboard straight away.
function Welcome({ token, onSignedIn, onFailed }) {
  const [error, setError] = useState('')
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    api('/api/auth/welcome', { method: 'POST', body: { token } })
      .then(onSignedIn)
      .catch((requestError) => setError(requestError.message))
  }, [token, onSignedIn])
  return (
    <div className="suspended">
      <div className="suspended-card">
        {error ? <>
          <span className="empty-icon"><Icon name="alert" size={22} /></span>
          <h1>We couldn’t open your workspace</h1>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={onFailed}>Go to sign in</button>
        </> : <>
          <span className="spinner" />
          <h1>Opening your OVO workspace…</h1>
          <p>Signing you in securely.</p>
        </>}
      </div>
    </div>
  )
}

// Public pages anyone with the link can open: /f/<token> (a form) and /s/<token> (a share link).
function readPublicPage() {
  const match = window.location.pathname.match(/^\/(f|s)\/([A-Za-z0-9_-]{8,64})\/?$/)
  return match ? { kind: match[1], token: match[2] } : null
}

function App() {
  const [publicPage] = useState(readPublicPage)
  if (publicPage?.kind === 'f') return <PublicForm token={publicPage.token} />
  if (publicPage?.kind === 's') return <PublicShare token={publicPage.token} />
  return <Main />
}

function Main() {
  const [linkToken] = useState(readLinkToken)
  const [entryPath] = useState(readEntryPath)
  const [account, setAccount] = useState(null)
  const [gateway, setGateway] = useState(false)
  const [checking, setChecking] = useState(!linkToken)
  const [welcoming, setWelcoming] = useState(linkToken?.mode === 'welcome')
  const [screen, setScreen] = useState(linkToken ? 'auth' : 'landing')
  const [authMode, setAuthMode] = useState(linkToken && linkToken.mode !== 'welcome' ? linkToken.mode : 'login')

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

  if (checking) return <div className="boot" aria-label="Loading OVO"><span className="spinner" /></div>
  if (welcoming) {
    return (
      <Welcome
        token={linkToken.token}
        onSignedIn={async () => { await authenticated(); setWelcoming(false) }}
        onFailed={() => { setWelcoming(false); setAuthMode('login'); setScreen('auth') }}
      />
    )
  }

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
