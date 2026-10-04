// DATE columns arrive as YYYY-MM-DD; parse them as local calendar days, not UTC instants.
export function parseDay(value) {
  if (!value) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function todayKey(date = new Date()) {
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDay(value, options = { month: 'short', day: 'numeric' }) {
  const date = parseDay(value)
  if (!date) return ''
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, sameYear ? options : { ...options, year: 'numeric' })
}

export function dueLabel(value) {
  if (!value) return null
  const days = Math.round((parseDay(value) - parseDay(todayKey())) / 86_400_000)
  if (days === 0) return { text: 'Due today', tone: 'warning' }
  if (days === 1) return { text: 'Due tomorrow', tone: 'warning' }
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: 'danger' }
  if (days < 7) return { text: `Due ${parseDay(value).toLocaleDateString(undefined, { weekday: 'short' })}`, tone: 'muted' }
  return { text: `Due ${formatDay(value)}`, tone: 'muted' }
}

export function formatDateTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatTime(value) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function timeAgo(value) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  const digits = exponent === 0 || value >= 100 || Number.isInteger(value) ? 0 : 1
  return `${value.toFixed(digits)} ${units[exponent]}`
}

export function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

export function greeting(date = new Date()) {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function slug(text = '') {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'
}

// Converts an ISO instant to the value a datetime-local input expects.
export function toLocalInput(value) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function capitalize(text = '') {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function formatPrice(amount, currency = 'NGN') {
  if (amount === null || amount === undefined) return null
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${Number(amount).toLocaleString()}`
  }
}
