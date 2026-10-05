import { useEffect, useState } from 'react'
import Icon from './components/Icon.jsx'
import { BrandMark, Field } from './components/ui.jsx'
import { api } from './lib/api.js'
import { capitalize } from './lib/format.js'
import { INDUSTRIES, SHEET_TEMPLATES } from '../shared/industries.js'
import './auth.css'

const copy = {
  login: { eyebrow: 'Welcome back', title: 'Sign in to your workspace', submit: 'Sign in' },
  register: { eyebrow: 'Start free', title: 'Create your OVO workspace', submit: 'Create workspace' },
  invite: { eyebrow: 'You’re invited', title: 'Join your team on OVO', submit: 'Join workspace' },
  reset: { eyebrow: 'Account recovery', title: 'Choose a new password', submit: 'Save new password' },
  forgot: { eyebrow: 'Account recovery', title: 'Forgot your password?' },
}

function AuthScreen({ mode, setMode, token, onAuthenticated, onBack, initialNotice = '', initialError = '' }) {
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState(initialNotice)
  const [busy, setBusy] = useState(false)
  const [tokenInfo, setTokenInfo] = useState(null)
  const [tokenError, setTokenError] = useState('')
  const [industry, setIndustry] = useState('')
  const [step, setStep] = useState(1)

  useEffect(() => {
    if (!token || !['invite', 'reset'].includes(mode)) return
    const path = mode === 'invite' ? `/api/auth/invitations/${token}` : `/api/auth/password-resets/${token}`
    api(path).then(setTokenInfo).catch((requestError) => setTokenError(requestError.message))
  }, [mode, token])

  function switchMode(next) {
    setError('')
    setNotice('')
    setStep(1)
    setMode(next)
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    if (['register', 'invite', 'reset'].includes(mode) && values.password !== values.confirmPassword) {
      setError('The passwords don’t match.')
      return
    }
    delete values.confirmPassword
    if (['register', 'invite'].includes(mode)) {
      if (!values.acceptTerms) {
        setError('Please accept the Terms of Use and Privacy Policy to continue.')
        return
      }
      values.acceptTerms = true
    }
    setBusy(true)
    try {
      if (mode === 'login') onAuthenticated(await api('/api/auth/login', { method: 'POST', body: values }))
      if (mode === 'register') onAuthenticated(await api('/api/auth/register', { method: 'POST', body: { ...values, industry } }))
      if (mode === 'invite') onAuthenticated(await api('/api/auth/accept-invite', { method: 'POST', body: { ...values, token } }))
      if (mode === 'reset') {
        await api('/api/auth/reset-password', { method: 'POST', body: { ...values, token } })
        setNotice('Your password has been updated. Sign in with your new password.')
        setMode('login')
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  const text = copy[mode]
  const tokenBlocked = ['invite', 'reset'].includes(mode) && (tokenError || !tokenInfo)

  return (
    <div className="auth">
      <aside className="auth-panel">
        <button type="button" className="auth-brand" onClick={onBack}>
          <BrandMark size={34} label="OVO" white />
          <span><small>ONE VISION. ONE ORGANIZATION.</small></span>
        </button>
        <div className="auth-orbit" aria-hidden="true"><i /><i /><i /><span /></div>
        <div className="auth-pitch">
          <span className="auth-kicker"><i />ONE VISION. ONE ORGANIZATION.</span>
          <h2>One platform for the way <em>your business</em> actually works.</h2>
          <ul>
            <li><Icon name="check" size={15} />A workspace shaped around your industry</li>
            <li><Icon name="check" size={15} />OVO Sheets: your records, spreadsheet-simple</li>
            <li><Icon name="check" size={15} />Clients, projects, files and team in one place</li>
          </ul>
        </div>
        <small className="auth-foot">© {new Date().getFullYear()} OVO</small>
      </aside>

      <main className="auth-main">
        <button type="button" className="auth-back" onClick={onBack}><Icon name="left" size={15} />Back to home</button>
        <div className="auth-card">
          {['login', 'register'].includes(mode) && (
            <div className="auth-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Log in</button>
              <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Create workspace</button>
            </div>
          )}
          <span className="auth-eyebrow">{text.eyebrow}</span>
          <h1>{text.title}</h1>

          {mode === 'invite' && tokenInfo && (
            <p className="auth-lede">Join <strong>{tokenInfo.organizationName}</strong> as {tokenInfo.role === 'admin' ? 'an' : 'a'} <strong>{capitalize(tokenInfo.role)}</strong>.</p>
          )}
          {mode === 'reset' && tokenInfo && <p className="auth-lede">Resetting the password for <strong>{tokenInfo.email}</strong>.</p>}
          {mode === 'register' && <p className="auth-lede">{step === 1 ? 'Step 1 of 2 · What kind of business are you? OVO shapes your workspace around it.' : 'Step 2 of 2 · Your 14-day trial starts today. No card required.'}</p>}

          {tokenError && (
            <div className="auth-alert">
              <Icon name="alert" size={16} />
              <span>{tokenError} Ask your workspace owner or admin for a new link.</span>
            </div>
          )}
          {notice && <div className="auth-notice"><Icon name="check" size={16} />{notice}</div>}

          {mode === 'forgot' ? (
            <div className="auth-forgot">
              <p>Email delivery isn’t set up for OVO yet, so we can’t send you a reset email.</p>
              <ol>
                <li>Ask the owner or an admin of your workspace to open <strong>Settings → Team</strong>.</li>
                <li>They choose <strong>Create password reset link</strong> next to your name.</li>
                <li>Open the link they send you and choose a new password.</li>
              </ol>
              <p className="muted">If you are the workspace owner and can’t sign in, contact OVO support.</p>
              <button type="button" className="auth-submit" onClick={() => switchMode('login')}>Back to sign in</button>
            </div>
          ) : mode === 'register' && step === 1 ? (
            <div className="industry-step">
              <div className="industry-grid" role="radiogroup" aria-label="Business type">
                {INDUSTRIES.map((item) => (
                  <button key={item.key} type="button" role="radio" aria-checked={industry === item.label} className={`industry-option tone-${item.color}${industry === item.label ? ' active' : ''}`} onClick={() => setIndustry(item.label)}>
                    <span className="industry-icon"><Icon name={item.icon} size={18} /></span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              {industry && (() => {
                const chosen = INDUSTRIES.find((item) => item.label === industry)
                return (
                  <p className="industry-preview">
                    <Icon name="sparkle" size={15} />
                    <span>Your workspace starts with {chosen.modules.map((key) => SHEET_TEMPLATES[key].name).join(', ')} — ready to use and easy to change.</span>
                  </p>
                )
              })()}
              <button type="button" className="auth-submit" disabled={!industry} onClick={() => setStep(2)}>Continue<Icon name="right" size={16} /></button>
            </div>
          ) : !tokenBlocked ? (
            <form className="auth-form" onSubmit={submit}>
              {mode === 'register' && <button type="button" className="auth-link auth-step-back" onClick={() => setStep(1)}><Icon name="left" size={14} />{industry}</button>}
              {mode === 'register' && <>
                <Field label="Business name"><input name="organizationName" minLength={2} maxLength={160} required autoComplete="organization" /></Field>
                <Field label="Business email"><input name="businessEmail" type="email" required /></Field>
              </>}
              {['register', 'invite'].includes(mode) && <Field label="Your full name"><input name="fullName" minLength={2} maxLength={120} required autoComplete="name" /></Field>}
              {mode === 'invite' && <Field label="Email"><input type="email" value={tokenInfo?.email || ''} readOnly disabled /></Field>}
              {['login', 'register'].includes(mode) && <Field label={mode === 'register' ? 'Your work email' : 'Work email'}><input name="email" type="email" required autoComplete="email" /></Field>}
              <Field label="Password" hint={mode !== 'login' ? 'At least 12 characters' : undefined}>
                <input name="password" type="password" required minLength={mode === 'login' ? 1 : 12} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              </Field>
              {mode !== 'login' && <Field label="Confirm password"><input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></Field>}
              {['register', 'invite'].includes(mode) && (
                <label className="auth-terms">
                  <input type="checkbox" name="acceptTerms" required />
                  <span>I agree to OVO’s <a href="/terms" target="_blank" rel="noreferrer">Terms of Use</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
                </label>
              )}
              {mode === 'login' && <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>Forgot password?</button>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? 'Please wait…' : text.submit}<Icon name="right" size={16} />
              </button>
            </form>
          ) : !tokenError && <div className="auth-loading"><span className="spinner" />Checking your link…</div>}

          {['invite', 'reset'].includes(mode) && (
            <p className="auth-switch">Already have access? <button type="button" onClick={() => switchMode('login')}>Sign in</button></p>
          )}
        </div>
      </main>
    </div>
  )
}

export default AuthScreen
