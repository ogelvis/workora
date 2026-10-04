import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { useWorkspace } from './context.js'
import { SheetIcon } from './views/Sheets.jsx'

// The global Create button: everything you can add, one click away.
export function CreateMenu({ items }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="create-root" ref={root}>
      <button type="button" className="create-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="plus" size={17} /><span>Create</span>
      </button>
      {open && (
        <div className="create-menu" role="menu">
          {items.map((group) => (
            <div key={group.label} className="create-group">
              <span className="create-label">{group.label}</span>
              <div className="create-items">
                {group.items.map((item) => (
                  <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); item.onSelect() }}>
                    <span className={`create-icon tone-${item.tone}`}><Icon name={item.icon} size={16} /></span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const SECTIONS = [
  { key: 'records', label: 'Records', icon: 'sheet' },
  { key: 'clients', label: 'Clients', icon: 'clients' },
  { key: 'projects', label: 'Projects', icon: 'projects' },
  { key: 'tasks', label: 'Tasks', icon: 'tasks' },
  { key: 'people', label: 'People', icon: 'team' },
  { key: 'sheets', label: 'Sheets', icon: 'sheet' },
  { key: 'files', label: 'Files', icon: 'files' },
  { key: 'messages', label: 'Messages', icon: 'chat' },
]

// Universal search: one box across records, clients, work, people, files and messages.
export function SearchPalette({ onClose }) {
  const { navigate, openForm, data } = useWorkspace()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef(null)

  useEffect(() => {
    input.current?.focus()
    document.body.classList.add('modal-open')
    return () => document.body.classList.remove('modal-open')
  }, [])

  useEffect(() => {
    const term = query.trim()
    if (!term) { setResults(null); return undefined }
    setBusy(true)
    const timer = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(term)}`)
        .then((result) => { setResults(result); setActive(0) })
        .catch(() => setResults({}))
        .finally(() => setBusy(false))
    }, 180)
    return () => clearTimeout(timer)
  }, [query])

  function go(action) {
    onClose()
    action()
  }

  const entries = []
  if (results) {
    for (const section of SECTIONS) {
      for (const item of results[section.key] || []) {
        let entry
        if (section.key === 'records') entry = { title: item.title, meta: `${item.sheetName}${item.match ? ` · ${item.match}` : ''}`, icon: <SheetIcon icon={item.icon} color={item.color} size="sm" />, run: () => navigate('sheet', { id: item.sheetId, record: item.id }) }
        if (section.key === 'clients') entry = { title: item.name, meta: [item.contactName, item.status].filter(Boolean).join(' · '), run: () => { const client = data.clients.find((record) => record.id === item.id); if (client) openForm('client', client); else navigate('clients') } }
        if (section.key === 'projects') entry = { title: item.name, meta: item.status, run: () => navigate('projects') }
        if (section.key === 'tasks') entry = { title: item.title, meta: `${item.status} · ${item.priority}`, run: () => { const task = data.tasks.find((record) => record.id === item.id); if (task) openForm('task', task); else navigate('tasks') } }
        if (section.key === 'people') entry = { title: item.fullName, meta: `${item.email} · ${item.role}`, run: () => navigate('chat', { dm: item.id }) }
        if (section.key === 'sheets') entry = { title: item.name, meta: 'Sheet', icon: <SheetIcon icon={item.icon} color={item.color} size="sm" />, run: () => navigate('sheet', { id: item.id }) }
        if (section.key === 'files') entry = { title: item.name, meta: item.vault ? `Vault · ${item.folder}` : item.folder, run: () => navigate(item.vault ? 'vault' : 'files') }
        if (section.key === 'messages') entry = { title: item.body, meta: `${item.author || 'Someone'} · ${item.kind === 'dm' ? `DM with ${item.where}` : `#${item.where}`}`, run: () => navigate('chat', item.kind === 'dm' ? { conversation: item.targetId } : { channel: item.targetId }) }
        entries.push({ ...entry, section })
      }
    }
  }

  function onKey(event) {
    if (event.key === 'Escape') onClose()
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(entries.length - 1, index + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) }
    if (event.key === 'Enter' && entries[active]) go(entries[active].run)
  }

  let lastSection = null
  return (
    <div className="modal-backdrop palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search everything">
        <label className="palette-input">
          <Icon name="search" size={19} />
          <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKey} placeholder="Search clients, records, people, files, messages…" aria-label="Search everything" />
          {busy ? <span className="spinner small" /> : <kbd>Esc</kbd>}
        </label>
        <div className="palette-results">
          {!results && (
            <div className="palette-hint">
              <Icon name="sparkle" size={20} />
              <p>Search across <b>every sheet record</b>, clients, projects, tasks, people, files and messages in one go.</p>
            </div>
          )}
          {results && !entries.length && !busy && <div className="palette-hint"><p>Nothing matches “{query}”.</p></div>}
          {entries.map((entry, index) => {
            const heading = entry.section !== lastSection ? entry.section : null
            lastSection = entry.section
            return (
              <div key={`${entry.section.key}-${index}`}>
                {heading && <span className="palette-section">{heading.label}</span>}
                <button type="button" className={`palette-item${index === active ? ' active' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => go(entry.run)}>
                  {entry.icon || <span className="palette-icon"><Icon name={entry.section.icon} size={15} /></span>}
                  <span><strong>{entry.title}</strong>{entry.meta && <small>{entry.meta}</small>}</span>
                  <Icon name="right" size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
