import { useCallback, useEffect, useState } from 'react'
import LandingPage from './LandingPage.jsx'
import AuthScreen from './AuthScreen.jsx'
import Workspace from './workspace/Workspace.jsx'
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
      {account ? (
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
