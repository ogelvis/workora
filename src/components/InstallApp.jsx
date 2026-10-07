import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { useInstall } from '../lib/install.js'
import './install.css'

const STEPS = {
  ios: {
    title: 'Add OVO to your iPhone or iPad',
    steps: [
      <>Open <strong>{location.host}</strong> in <strong>Safari</strong>.</>,
      <>Tap the <strong>Share</strong> button <span className="ia-glyph" aria-label="Share">⬆︎</span> at the bottom (or top) of the screen.</>,
      <>Scroll down and tap <strong>Add to Home Screen</strong>.</>,
      <>Tap <strong>Add</strong>. OVO now opens from your home screen like any app.</>,
    ],
  },
  android: {
    title: 'Install OVO on your Android phone',
    steps: [
      <>Open <strong>{location.host}</strong> in <strong>Chrome</strong>.</>,
      <>Tap the <strong>⋮</strong> menu at the top right.</>,
      <>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</>,
      <>Tap <strong>Install</strong>. OVO appears with your other apps.</>,
    ],
  },
  desktop: {
    title: 'Install OVO on your computer',
    steps: [
      <>Open <strong>{location.host}</strong> in <strong>Chrome</strong> or <strong>Edge</strong>.</>,
      <>Click the <strong>install icon</strong> at the right end of the address bar, or open the <strong>⋮</strong> menu and choose <strong>Install OVO</strong>.</>,
      <>Click <strong>Install</strong>. OVO opens in its own window.</>,
      <>On your phone, open the same address and follow the phone steps.</>,
    ],
  },
}

function InstallGuide({ initial, onClose }) {
  const [tab, setTab] = useState(initial)
  const guide = STEPS[tab]
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Rendered at the top of the page so no animated or sticky section can cover it.
  return createPortal(
    <div className="ia-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ia-dialog" role="dialog" aria-modal="true" aria-labelledby="ia-title">
        <button type="button" className="ia-close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        <img className="ia-icon" src="/icon-192.png" alt="" width="64" height="64" />
        <h2 id="ia-title">{guide.title}</h2>
        <p className="ia-lede">Free, no app store needed. It takes under a minute.</p>
        <div className="ia-tabs" role="tablist" aria-label="Device">
          {[['ios', 'iPhone / iPad'], ['android', 'Android'], ['desktop', 'Computer']].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>
          ))}
        </div>
        <ol className="ia-steps">{guide.steps.map((step, index) => <li key={index}><span>{step}</span></li>)}</ol>
        <button type="button" className="ia-done" onClick={onClose}>Got it</button>
      </div>
    </div>,
    document.body,
  )
}

// "Get the app" button: one tap where the browser supports it, otherwise clear steps.
export function InstallButton({ className = '', children = 'Get the app', icon = 'download', ...rest }) {
  const install = useInstall()
  const [guide, setGuide] = useState(false)
  if (install.installed) return null
  async function start() {
    if (install.canPrompt) await install.prompt()
    else setGuide(true)
  }
  return (
    <>
      <button type="button" className={className} onClick={start} {...rest}>{icon && <span className="ia-btn-icon"><Icon name={icon} size={15} /></span>}<span>{children}</span></button>
      {guide && <InstallGuide initial={install.platform} onClose={() => setGuide(false)} />}
    </>
  )
}

// A small strip on phones, offering the app once until it's installed or dismissed.
export function InstallBanner() {
  const install = useInstall()
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('ovo.installBanner') === 'hidden' } catch { return false } })
  const [guide, setGuide] = useState(false)
  if (install.installed || hidden || install.platform === 'desktop') return null
  function dismiss() {
    try { localStorage.setItem('ovo.installBanner', 'hidden') } catch { /* private mode */ }
    setHidden(true)
  }
  return (
    <div className="ia-banner" role="region" aria-label="Get the OVO app">
      <img src="/icon-192.png" alt="" width="36" height="36" />
      <div><strong>Get the OVO app</strong><small>Faster access from your home screen.</small></div>
      <button type="button" className="ia-banner-install" onClick={async () => { if (install.canPrompt) await install.prompt(); else setGuide(true) }}>Install</button>
      <button type="button" className="ia-banner-close" onClick={dismiss} aria-label="Not now"><Icon name="close" size={16} /></button>
      {guide && <InstallGuide initial={install.platform} onClose={() => setGuide(false)} />}
    </div>
  )
}
