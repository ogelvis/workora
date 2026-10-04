import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { initials } from '../lib/format.js'

// The OVO wordmark. `size` is the height in pixels; the logo is about three times as wide.
export function BrandMark({ size = 28, label, white = false }) {
  return <img className="brand-logo" src={white ? '/ovo-logo-white.png' : '/ovo-logo.png'} alt={label || ''} aria-hidden={label ? undefined : 'true'} height={size} style={{ height: size }} />
}

export function Avatar({ name, size = 'md' }) {
  // A stable soft tint per person, drawn from the brand's muted palette.
  const tints = ['#e1dcef', '#e3e8f7', '#f4e6dc', '#efe2ea', '#e8e7ef', '#f1ecd9']
  const index = [...(name || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tints.length
  return <span className={`avatar avatar-${size}`} style={{ background: tints[index] }} title={name}>{initials(name)}</span>
}

export function Pill({ tone = 'neutral', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

export function PageHeader({ eyebrow, title, description, children }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  )
}

export function Button({ variant = 'secondary', icon, children, size, className = '', ...props }) {
  return (
    <button type="button" className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`} {...props}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
    </button>
  )
}

export function IconButton({ icon, label, className = '', ...props }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...props}>
      <Icon name={icon} size={17} />
    </button>
  )
}

export function Empty({ icon = 'overview', title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} size={15} />}
          {option.label}
          {option.count !== undefined && <span className="count">{option.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Meter({ value, max, tone }) {
  const percent = max ? Math.min(100, (value / max) * 100) : 0
  const level = tone || (percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'ok')
  return (
    <div className={`meter meter-${level}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${Math.max(percent, value ? 2 : 0)}%` }} />
    </div>
  )
}

export function Modal({ title, eyebrow, onClose, children, width = 560, busy = false }) {
  const titleId = useId()
  const panel = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const first = panel.current?.querySelector('input, select, textarea, button:not(.modal-close)')
    first?.focus()
    function onKey(event) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('modal-open')
      previous?.focus?.()
    }
  }, [onClose, busy])
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section ref={panel} className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <IconButton icon="close" label="Close" className="modal-close" onClick={onClose} disabled={busy} />
        </div>
        {children}
      </section>
    </div>
  )
}

export function Confirm({ title, message, confirmLabel = 'Delete', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }
  return (
    <Modal title={title} onClose={onClose} width={440} busy={busy}>
      <div className="modal-body">
        <p className="confirm-text">{message}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-foot">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={run} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Button>
      </div>
    </Modal>
  )
}

export function Field({ label, hint, children, wide }) {
  return (
    <label className={`field${wide ? ' field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Menu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    function onDown(event) {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const visible = items.filter(Boolean)
  if (!visible.length) return null
  return (
    <div className="menu" ref={root}>
      <IconButton icon="more" label={label} aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen(!open) }} />
      {open && (
        <div className="menu-list" role="menu">
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : ''}
              onClick={(event) => { event.stopPropagation(); setOpen(false); item.onSelect() }}
            >
              {item.icon && <Icon name={item.icon} size={15} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), tone === 'error' ? 6000 : 3200)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <Icon name={toast.tone === 'error' ? 'alert' : 'check'} size={16} />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
