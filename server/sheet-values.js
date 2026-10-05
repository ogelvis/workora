import { randomBytes } from 'node:crypto'
import { MANAGERS } from './lib.js'

export function columnId() {
  return `c_${randomBytes(5).toString('hex')}`
}

// Keep only known columns and store each value in the shape its column expects.
export function clean(data, columns) {
  const result = {}
  for (const column of columns) {
    if (!(column.id in data)) continue
    let value = data[column.id]
    if (value === '' || value === undefined) value = null
    if (value !== null) {
      if (column.type === 'number' || column.type === 'currency') {
        const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''))
        value = Number.isFinite(parsed) && String(value).trim() !== '' ? parsed : null
      } else if (column.type === 'checkbox') {
        value = value === true || ['true', 'yes', '1', 'y', '✓', 'x'].includes(String(value).trim().toLowerCase())
      } else if (column.type === 'date') {
        const text = String(value).trim()
        const iso = /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : (() => {
          const parsed = new Date(text)
          return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
        })()
        value = iso
      } else {
        value = String(value)
      }
    }
    result[column.id] = value
  }
  return result
}

// Permission levels inside a sheet, weakest first. 'none' hides the sheet entirely.
export const LEVELS = ['none', 'view', 'comment', 'edit', 'full']

export function permissionFor(auth, sheet) {
  if (MANAGERS.includes(auth.role) || sheet.createdById === auth.userId) return 'full'
  const access = sheet.access || {}
  const level = access.members?.[auth.userId] || access.default || 'edit'
  return LEVELS.includes(level) ? level : 'edit'
}

export function allows(level, needed) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(needed)
}

// How a value reads to people: used by automations, notifications and share pages.
export function readable(column, value, members = new Map()) {
  if (value === null || value === undefined || value === '') return ''
  if (column.type === 'checkbox') return value ? 'Yes' : 'No'
  if (column.type === 'person') return members.get(value) || ''
  if (column.type === 'currency' && typeof value === 'number') return `₦${value.toLocaleString('en-NG')}`
  return String(value)
}
