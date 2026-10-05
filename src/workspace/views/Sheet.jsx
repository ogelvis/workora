import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Field, IconButton, Modal, copyText } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { formatDateTime, timeAgo } from '../../lib/format.js'
import {
  applyView, displayValue, exportCsv, exportXlsx, groupRows, guessType, operatorsFor, optionFor,
  readSpreadsheetFile, toTable, toTsv,
} from '../../lib/sheetData.js'
import { COLUMN_TYPES, OPTION_COLORS, itemName } from '../../../shared/industries.js'
import { useWorkspace } from '../context.js'
import { SHEET_COLORS, SHEET_ICONS, SheetIcon } from './Sheets.jsx'
import { ShareModal } from '../Share.jsx'

const typeInfo = Object.fromEntries(COLUMN_TYPES.map((column) => [column.type, column]))
const blankView = { id: 'all', name: 'All records', search: '', filters: [], sort: null, groupBy: null, hidden: [] }
const newId = () => Math.random().toString(36).slice(2, 10)

// ---------------------------------------------------------------- Small pieces

function Popover({ label, icon, active, children, align = 'left', wide }) {
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
    <div className="popover-root" ref={root}>
      <button type="button" className={`tool-btn${active ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={icon} size={15} />{label}
      </button>
      {open && <div className={`popover popover-${align}${wide ? ' popover-wide' : ''}`}>{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </div>
  )
}

function Chip({ option, children }) {
  return <span className={`chip tone-${option?.color || 'slate'}`}>{children ?? option?.label}</span>
}

function CellView({ column, value, members }) {
  if (value === null || value === undefined || value === '') return <span className="cell-empty" />
  switch (column.type) {
    case 'select': return <Chip option={optionFor(column, value) || { label: value, color: 'slate' }} />
    case 'checkbox': return <span className={`cell-check${value ? ' on' : ''}`}>{value && <Icon name="check" size={12} />}</span>
    case 'person': {
      const name = displayValue(column, value, members)
      return name ? <span className="assignee"><Avatar name={name} size="xs" />{name}</span> : <span className="muted">Former member</span>
    }
    case 'email': return <a href={`mailto:${value}`} onClick={(event) => event.stopPropagation()}>{value}</a>
    case 'phone': return <a href={`tel:${String(value).replace(/\s+/g, '')}`} onClick={(event) => event.stopPropagation()}>{value}</a>
    case 'url': {
      const href = /^https?:\/\//i.test(value) ? value : `https://${value}`
      return <a href={href} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>{String(value).replace(/^https?:\/\//i, '')}</a>
    }
    case 'number': case 'currency': return <span className="cell-num">{displayValue(column, value)}</span>
    default: return <span>{displayValue(column, value, members)}</span>
  }
}

// The editor a cell (or record field) uses for its column type.
function CellEditor({ column, value, members, onCommit, onCancel, autoFocus = true, inline = true }) {
  const [draft, setDraft] = useState(value ?? '')
  const commit = (next = draft) => onCommit(next === '' ? null : next)
  const keys = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel?.() }
    if (event.key === 'Enter' && (column.type !== 'longtext' || event.ctrlKey || event.metaKey)) { event.preventDefault(); commit() }
  }
  const common = { autoFocus, onKeyDown: keys, className: inline ? 'cell-input' : '' }
  switch (column.type) {
    case 'select':
      return (
        <select {...common} value={draft} onChange={(event) => { setDraft(event.target.value); onCommit(event.target.value || null) }} onBlur={() => onCancel?.()}>
          <option value="">—</option>
          {(column.options || []).map((option) => <option key={option.label} value={option.label}>{option.label}</option>)}
          {draft && !optionFor(column, draft) && <option value={draft}>{draft}</option>}
        </select>
      )
    case 'person':
      return (
        <select {...common} value={draft} onChange={(event) => { setDraft(event.target.value); onCommit(event.target.value || null) }} onBlur={() => onCancel?.()}>
          <option value="">—</option>
          {members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
        </select>
      )
    case 'checkbox':
      return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onCommit(event.target.checked)} />
    case 'date':
      return <input {...common} type="date" value={draft || ''} onChange={(event) => setDraft(event.target.value)} onBlur={() => commit()} />
    case 'longtext':
      return <textarea {...common} rows={inline ? 4 : 3} maxLength={5000} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => commit()} />
    case 'number': case 'currency':
      return <input {...common} type="number" step="any" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(draft === '' ? '' : Number(draft))} />
    default:
      return <input {...common} type={column.type === 'email' ? 'email' : column.type === 'url' ? 'url' : column.type === 'phone' ? 'tel' : 'text'} maxLength={5000} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => commit()} />
  }
}

// ---------------------------------------------------------------- Column editor

function ColumnModal({ column, onSave, onClose }) {
  const [type, setType] = useState(column?.type || 'text')
  const [options, setOptions] = useState(column?.options?.length ? column.options : [{ label: 'Option 1', color: 'blue' }, { label: 'Option 2', color: 'green' }])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const name = new FormData(event.currentTarget).get('name').trim()
    const cleaned = options.map((option) => ({ ...option, label: option.label.trim() })).filter((option) => option.label)
    if (type === 'select' && !cleaned.length) { setError('Add at least one choice.'); return }
    if (type === 'select' && new Set(cleaned.map((option) => option.label.toLowerCase())).size !== cleaned.length) { setError('Each choice needs a different name.'); return }
    setBusy(true)
    try {
      await onSave({ ...(column || {}), name, type, ...(type === 'select' ? { options: cleaned } : { options: undefined }) })
      onClose()
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={column ? 'Edit column' : 'Add column'} onClose={onClose} width={520} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body stack-sm">
          <Field label="Column name"><input name="name" required maxLength={60} defaultValue={column?.name || ''} placeholder="e.g. Budget" /></Field>
          <div className="field">
            <span className="field-label">Type</span>
            <div className="type-grid">
              {COLUMN_TYPES.map((item) => (
                <button key={item.type} type="button" className={`type-option${type === item.type ? ' active' : ''}`} onClick={() => setType(item.type)}>
                  <Icon name={item.icon} size={15} />{item.label}
                </button>
              ))}
            </div>
            {column && column.type !== type && <span className="field-hint">Changing the type keeps values that still fit and clears the rest.</span>}
          </div>
          {type === 'select' && (
            <div className="field">
              <span className="field-label">Choices</span>
              <div className="option-list">
                {options.map((option, index) => (
                  <div key={index} className="option-row">
                    <select aria-label="Colour" className={`option-color tone-${option.color}`} value={option.color} onChange={(event) => setOptions(options.map((item, at) => (at === index ? { ...item, color: event.target.value } : item)))}>
                      {OPTION_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
                    </select>
                    <input value={option.label} maxLength={60} aria-label={`Choice ${index + 1}`} onChange={(event) => setOptions(options.map((item, at) => (at === index ? { ...item, label: event.target.value } : item)))} />
                    <IconButton icon="up" label="Move up" disabled={!index} onClick={() => setOptions(options.map((item, at, all) => (at === index - 1 ? all[index] : at === index ? all[index - 1] : item)))} />
                    <IconButton icon="trash" label="Remove choice" onClick={() => setOptions(options.filter((_item, at) => at !== index))} />
                  </div>
                ))}
              </div>
              <button type="button" className="text-btn" onClick={() => setOptions([...options, { label: '', color: OPTION_COLORS[options.length % OPTION_COLORS.length] }])}><Icon name="plus" size={14} />Add choice</button>
            </div>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : column ? 'Save column' : 'Add column'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function DetailsModal({ sheet, onSave, onClose }) {
  const [icon, setIcon] = useState(sheet.icon)
  const [color, setColor] = useState(sheet.color)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    setBusy(true)
    try {
      await onSave({ name: values.name, description: values.description, icon, color })
      onClose()
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }
  return (
    <Modal title="Sheet details" onClose={onClose} width={560} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body stack-sm">
          <Field label="Name"><input name="name" required maxLength={80} defaultValue={sheet.name} /></Field>
          <Field label="Description"><input name="description" maxLength={300} defaultValue={sheet.description} /></Field>
          <div className="field"><span className="field-label">Icon</span><div className="swatches">
            {SHEET_ICONS.map((name) => <button key={name} type="button" className={`swatch-icon${icon === name ? ' active' : ''}`} onClick={() => setIcon(name)} aria-label={name}><Icon name={name} size={16} /></button>)}
          </div></div>
          <div className="field"><span className="field-label">Colour</span><div className="swatches">
            {SHEET_COLORS.map((name) => <button key={name} type="button" className={`swatch tone-${name}${color === name ? ' active' : ''}`} onClick={() => setColor(name)} aria-label={name} />)}
          </div></div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="modal-foot"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>Save</Button></div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- Import

function ImportModal({ sheet, canDesign, onImported, onClose }) {
  const [table, setTable] = useState(null)
  const [fileName, setFileName] = useState('')
  const [addColumns, setAddColumns] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function choose(file) {
    setError('')
    try {
      const rows = await readSpreadsheetFile(file)
      if (rows.length < 2) throw new Error('The file needs a heading row and at least one record.')
      setTable(rows)
      setFileName(file.name)
    } catch (readError) {
      setError(readError.message || 'This file could not be read.')
    }
  }

  const headers = table ? table[0].map((header) => String(header ?? '').trim()) : []
  const matched = headers.map((header) => sheet.columns.find((column) => column.name.toLowerCase() === header.toLowerCase()))
  const newHeaders = headers.filter((header, index) => header && !matched[index])

  async function run() {
    setBusy(true)
    setError('')
    try {
      // Missing columns are created first, with a type guessed from their values.
      if (addColumns && canDesign && newHeaders.length) {
        const additions = newHeaders.map((header) => {
          const index = headers.indexOf(header)
          return { name: header.slice(0, 60), type: guessType(table.slice(1).map((row) => row[index])) }
        })
        await api(`/api/sheets/${sheet.id}`, { method: 'PUT', body: { columns: [...sheet.columns, ...additions] } })
      }
      const result = await api(`/api/sheets/${sheet.id}/import`, {
        method: 'POST',
        body: { headers: headers.map((header) => header.slice(0, 60)), rows: table.slice(1, 5001).map((row) => headers.map((_header, index) => row[index] ?? null)) },
      })
      await onImported(result.imported)
      onClose()
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Import records" eyebrow={sheet.name} onClose={onClose} width={620} busy={busy}>
      <div className="modal-body stack-sm">
        {!table ? (
          <label className="dropzone import-drop">
            <input type="file" accept=".csv,.tsv,.txt,.xlsx" hidden onChange={(event) => event.target.files[0] && choose(event.target.files[0])} />
            <span className="empty-icon"><Icon name="file_in" size={22} /></span>
            <strong>Choose an Excel (.xlsx) or CSV file</strong>
            <span>The first row should hold the column names.</span>
          </label>
        ) : (
          <>
            <div className="import-summary">
              <Icon name="sheet" size={18} />
              <div><strong>{fileName}</strong><span>{(table.length - 1).toLocaleString()} records · {headers.filter(Boolean).length} columns</span></div>
              <button type="button" className="text-btn" onClick={() => setTable(null)}>Choose another</button>
            </div>
            <div className="import-columns">
              {headers.map((header, index) => header && (
                <span key={`${header}-${index}`} className={`chip ${matched[index] ? 'tone-green' : addColumns && canDesign ? 'tone-blue' : 'tone-slate'}`}>
                  {matched[index] ? <Icon name="check" size={12} /> : addColumns && canDesign ? <Icon name="plus" size={12} /> : null}{header}
                </span>
              ))}
            </div>
            <p className="field-hint">Green columns match this sheet. {newHeaders.length > 0 && (canDesign ? 'Blue columns will be added.' : 'Grey columns will be skipped: only managers or the sheet’s creator can add columns.')}</p>
            {newHeaders.length > 0 && canDesign && <label className="check-row"><input type="checkbox" checked={addColumns} onChange={(event) => setAddColumns(event.target.checked)} /> Add missing columns ({newHeaders.length})</label>}
            {table.length > 5001 && <p className="form-error">Only the first 5,000 records will be imported.</p>}
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-foot">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="upload" disabled={!table || busy} onClick={run}>{busy ? 'Importing…' : `Import ${table ? (Math.min(table.length - 1, 5000)).toLocaleString() : ''} records`}</Button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- Record panel

function RecordPanel({ sheet, row, members, canEdit, canComment, onChange, onDelete, onShare, onClose }) {
  const { account, toast } = useWorkspace()
  const [events, setEvents] = useState(null)
  const [comment, setComment] = useState('')
  const [tab, setTab] = useState('details')
  const titleColumn = sheet.columns[0]

  const loadEvents = useCallback(() => {
    api(`/api/sheets/${sheet.id}/rows/${row.id}/timeline`).then((result) => setEvents(result.events)).catch(() => setEvents([]))
  }, [sheet.id, row.id])

  useEffect(() => { loadEvents() }, [loadEvents, row.updatedAt])
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !event.target.closest?.('input, textarea, select')) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function send(event) {
    event.preventDefault()
    if (!comment.trim()) return
    try {
      const result = await api(`/api/sheets/${sheet.id}/rows/${row.id}/comments`, { method: 'POST', body: { body: comment } })
      setEvents((current) => [result.event, ...(current || [])])
      setComment('')
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  const comments = events?.filter((item) => item.kind === 'comment').length || 0
  const title = titleColumn ? displayValue(titleColumn, row.data[titleColumn.id], members) : ''

  return (
    <aside className="record-panel" aria-label="Record">
      <header className="record-head">
        <SheetIcon icon={sheet.icon} color={sheet.color} size="sm" />
        <div><span className="eyebrow">{sheet.name}</span><h2>{title || 'Untitled record'}</h2></div>
        <IconButton icon="copy" label="Copy record" onClick={async () => toast(await copyText(sheet.columns.map((column) => `${column.name}: ${displayValue(column, row.data[column.id], members)}`).join('\n')) ? 'Record copied' : 'Copy failed', 'success')} />
        <IconButton icon="link" label="Share record" onClick={onShare} />
        {canEdit && <IconButton icon="trash" label="Delete record" onClick={() => onDelete(row)} />}
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>
      <div className="record-tabs">
        <button type="button" className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>Details</button>
        <button type="button" className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity & comments{comments > 0 && <em>{comments}</em>}</button>
      </div>
      {tab === 'details' ? (
        <div className="record-fields">
          {sheet.columns.map((column) => (
            <label key={`${column.id}-${row.updatedAt}`} className="record-field">
              <span><Icon name={typeInfo[column.type]?.icon || 'text'} size={13} />{column.name}</span>
              {canEdit ? (
                <CellEditor column={column} value={row.data[column.id]} members={members} inline={false} autoFocus={false}
                  onCommit={(value) => { if (JSON.stringify(value ?? null) !== JSON.stringify(row.data[column.id] ?? null)) onChange(row, column.id, value) }} />
              ) : <div className="record-value"><CellView column={column} value={row.data[column.id]} members={members} /></div>}
            </label>
          ))}
          <p className="record-meta">Added {formatDateTime(row.createdAt)} · Updated {timeAgo(row.updatedAt)}</p>
        </div>
      ) : (
        <div className="record-activity">
          {canComment ? <form className="comment-box" onSubmit={send}>
            <Avatar name={account.user.fullName} size="sm" />
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Discuss this record with your team…" rows={2} maxLength={4000}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) send(event) }} />
            <IconButton icon="send" label="Post comment" type="submit" disabled={!comment.trim()} />
          </form> : <p className="muted-note">You can view this record’s history but not comment on it.</p>}
          <ol className="timeline">
            {(events || []).map((item) => (
              <li key={item.id} className={`timeline-item kind-${item.kind}`}>
                <span className="timeline-dot" />
                <div>
                  {item.kind === 'comment' ? (
                    <><p className="timeline-who"><strong>{item.userName || 'Former member'}</strong> commented · {timeAgo(item.createdAt)}</p><p className="timeline-comment">{item.body}</p></>
                  ) : (
                    <p className="timeline-who"><strong>{item.userName || 'Someone'}</strong> {item.kind === 'created' ? 'created this record' : <>changed {item.body}</>} · {timeAgo(item.createdAt)}</p>
                  )}
                </div>
              </li>
            ))}
            {events && !events.length && <li className="muted">No activity yet.</li>}
          </ol>
        </div>
      )}
    </aside>
  )
}

// ---------------------------------------------------------------- Printing

function printSheet(sheet, columns, rows, members, organization) {
  const table = toTable(columns, rows, members)
  const escape = (text) => String(text).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.append(frame)
  frame.contentDocument.write(`<!doctype html><html><head><title>${escape(sheet.name)}</title><style>
    body{font:12px Inter,Segoe UI,system-ui,sans-serif;color:#1c1a33;margin:24px}
    h1{font-size:18px;margin:0 0 2px}p{color:#6b6883;margin:0 0 14px}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #e6e3f0;padding:6px 8px;text-align:left;vertical-align:top}
    th{background:#f4f2fa;font-weight:700}tr:nth-child(even) td{background:#fbfaff}
    @page{size:landscape;margin:12mm}</style></head><body>
    <h1>${escape(sheet.name)}</h1><p>${escape(organization)} · ${rows.length} records · printed ${new Date().toLocaleString()}</p>
    <table><thead><tr>${table[0].map((cell) => `<th>${escape(cell)}</th>`).join('')}</tr></thead>
    <tbody>${table.slice(1).map((line) => `<tr>${line.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`)
  frame.contentDocument.close()
  setTimeout(() => {
    frame.contentWindow.focus()
    frame.contentWindow.print()
    setTimeout(() => frame.remove(), 2000)
  }, 150)
}

// ---------------------------------------------------------------- The sheet

function Sheet() {
  const { account, params, data, reload, navigate, toast, confirm } = useWorkspace()
  const members = data.members
  const [sheet, setSheet] = useState(null)
  const [rows, setRows] = useState([])
  const [failed, setFailed] = useState('')
  const [view, setView] = useState(blankView)
  const [selected, setSelected] = useState(() => new Set())
  const [editing, setEditing] = useState(null)
  const [openRow, setOpenRow] = useState(null)
  const [modal, setModal] = useState(null)
  const id = params.id

  const load = useCallback(async () => {
    try {
      const result = await api(`/api/sheets/${id}`)
      setSheet(result.sheet)
      setRows(result.rows)
      if (params.record && result.rows.some((row) => row.id === params.record)) setOpenRow(params.record)
    } catch (error) {
      setFailed(error.message)
    }
    // Only the sheet id decides when to reload; the record param is read on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    setSheet(null); setFailed(''); setView(blankView); setSelected(new Set()); setOpenRow(null)
    load()
  }, [load])

  // Create → <record type> arrives with ?add=<stamp>: start one fresh record and open it.
  const handledAdd = useRef(null)
  useEffect(() => {
    if (!params.add || handledAdd.current === params.add || sheet?.id !== id) return
    handledAdd.current = params.add
    window.history.replaceState(null, '', `#/sheet?id=${id}`)
    api(`/api/sheets/${id}/rows`, { method: 'POST', body: { data: {} } })
      .then((created) => { setRows((current) => [...current, created.row]); setOpenRow(created.row.id); reload(['sheets']) })
      .catch((error) => toast(error.message, 'error'))
  }, [params.add, id, sheet?.id, reload, toast])

  const visibleColumns = useMemo(() => (sheet ? sheet.columns.filter((column) => !(view.hidden || []).includes(column.id)) : []), [sheet, view.hidden])
  const filtered = useMemo(() => (sheet ? applyView(rows, sheet.columns, view, members) : []), [rows, sheet, view, members])
  const groupColumn = sheet?.columns.find((column) => column.id === view.groupBy)
  const groups = useMemo(() => groupRows(filtered, groupColumn, members), [filtered, groupColumn, members])

  if (failed) {
    return <div className="empty"><span className="empty-icon"><Icon name="alert" size={22} /></span><strong>{failed}</strong><Button onClick={() => navigate('sheets')}>Back to sheets</Button></div>
  }
  if (!sheet) return <div className="card chart-skeleton" />

  const canDesign = sheet.canDesign
  const permission = sheet.permission || 'edit'
  const canEdit = ['edit', 'full'].includes(permission)
  const canComment = permission !== 'view'
  const patchView = (changes) => setView((current) => ({ ...current, ...changes }))

  async function saveSheet(changes, message) {
    const result = await api(`/api/sheets/${sheet.id}`, { method: 'PUT', body: changes })
    setSheet((current) => ({ ...current, ...result.sheet }))
    if ('columns' in changes) await load()
    if (['name', 'icon', 'color', 'pinned', 'description'].some((key) => key in changes)) reload(['sheets'])
    if (message) toast(message)
  }

  async function updateCell(row, columnId, value) {
    const before = row.data[columnId]
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, data: { ...item.data, [columnId]: value } } : item)))
    try {
      const result = await api(`/api/sheets/${sheet.id}/rows/${row.id}`, { method: 'PATCH', body: { data: { [columnId]: value } } })
      setRows((current) => current.map((item) => (item.id === row.id ? result.row : item)))
    } catch (error) {
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, data: { ...item.data, [columnId]: before } } : item)))
      toast(error.message, 'error')
    }
  }

  async function addRow(prefill = {}) {
    try {
      // New records land in the group (or filtered status) you're looking at.
      const data = { ...prefill }
      const result = await api(`/api/sheets/${sheet.id}/rows`, { method: 'POST', body: { data } })
      setRows((current) => [...current, result.row])
      const first = visibleColumns[0]
      if (first) setEditing({ rowId: result.row.id, columnId: first.id })
      reload(['sheets'])
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  function deleteRows(ids) {
    confirm({
      title: ids.length === 1 ? 'Delete record?' : `Delete ${ids.length} records?`,
      message: 'Deleted records and their comments can’t be recovered.',
      onConfirm: async () => {
        await api(`/api/sheets/${sheet.id}/rows/delete`, { method: 'POST', body: { ids } })
        setRows((current) => current.filter((row) => !ids.includes(row.id)))
        setSelected(new Set())
        if (ids.includes(openRow)) setOpenRow(null)
        reload(['sheets'])
        toast(ids.length === 1 ? 'Record deleted' : `${ids.length} records deleted`)
      },
    })
  }

  async function saveColumn(column, index) {
    const columns = [...sheet.columns]
    if (column.id) columns[columns.findIndex((item) => item.id === column.id)] = column
    else columns.splice(index ?? columns.length, 0, column)
    await saveSheet({ columns }, column.id ? 'Column saved' : 'Column added')
  }

  function moveColumn(column, step) {
    const columns = [...sheet.columns]
    const from = columns.findIndex((item) => item.id === column.id)
    const to = from + step
    if (to < 0 || to >= columns.length) return
    ;[columns[from], columns[to]] = [columns[to], columns[from]]
    saveSheet({ columns }).catch((error) => toast(error.message, 'error'))
  }

  function deleteColumn(column) {
    confirm({
      title: `Delete “${column.name}”?`,
      message: 'This removes the column and its values from every record.',
      onConfirm: () => saveSheet({ columns: sheet.columns.filter((item) => item.id !== column.id) }, 'Column deleted'),
    })
  }

  function saveCurrentView(name) {
    const saved = { ...view, id: view.id === 'all' ? newId() : view.id, name: name.trim().slice(0, 40) }
    const views = view.id === 'all' ? [...sheet.views, saved] : sheet.views.map((item) => (item.id === view.id ? saved : item))
    saveSheet({ views }, 'View saved').then(() => setView(saved)).catch((error) => toast(error.message, 'error'))
  }

  function deleteView(target) {
    saveSheet({ views: sheet.views.filter((item) => item.id !== target.id) }, 'View removed').then(() => setView(blankView)).catch((error) => toast(error.message, 'error'))
  }

  const selectedRows = rows.filter((row) => selected.has(row.id))
  const exportRows = selectedRows.length ? selectedRows : filtered
  const allChecked = filtered.length > 0 && filtered.every((row) => selected.has(row.id))
  const numberColumns = visibleColumns.filter((column) => column.type === 'number' || column.type === 'currency')
  const activeRow = rows.find((row) => row.id === openRow)
  const filtersOn = (view.filters || []).length

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(filtered.map((row) => row.id)))
  }

  function prefillFor(group) {
    if (!groupColumn || !group.key) return {}
    return { [groupColumn.id]: groupColumn.type === 'checkbox' ? group.key === 'Yes' : group.key }
  }

  return (
    <div className={`sheet-page${activeRow ? ' with-panel' : ''}`}>
      <header className="sheet-head">
        <a href="#/sheets" className="sheet-back" aria-label="All sheets"><Icon name="left" size={16} /></a>
        <SheetIcon icon={sheet.icon} color={sheet.color} size="lg" />
        <div className="sheet-title">
          <h1>{sheet.name}</h1>
          <p>{sheet.description || 'Custom sheet'} · {rows.length.toLocaleString()} records</p>
        </div>
        <div className="sheet-actions">
          {permission !== 'full' && <span className={`perm-badge perm-${permission}`}><Icon name={canEdit ? 'edit' : canComment ? 'chat' : 'eye'} size={13} />{canEdit ? 'Can edit' : canComment ? 'Can comment' : 'View only'}</span>}
          <Button icon="link" onClick={() => setModal({ type: 'share' })}>Share</Button>
          {canEdit && <Button icon="file_in" onClick={() => setModal({ type: 'import' })}>Import</Button>}
          <Popover label="Export" icon="download" align="right">
            {(close) => (
              <div className="menu-list static">
                <span className="popover-label">{selectedRows.length ? `${selectedRows.length} selected records` : `${filtered.length} records in this view`}</span>
                <button type="button" onClick={() => { exportXlsx(sheet.name, visibleColumns, exportRows, members); close() }}><Icon name="sheet" size={15} />Excel (.xlsx)</button>
                <button type="button" onClick={() => { exportCsv(sheet.name, visibleColumns, exportRows, members); close() }}><Icon name="download" size={15} />CSV</button>
                <button type="button" onClick={() => { printSheet(sheet, visibleColumns, exportRows, members, account.organization.name); close() }}><Icon name="print" size={15} />Print or save as PDF</button>
                <button type="button" onClick={async () => { close(); toast(await copyText(toTsv(visibleColumns, exportRows, members)) ? 'Copied — paste into Excel or Google Sheets' : 'Copy failed', 'success') }}><Icon name="copy" size={15} />Copy as table</button>
              </div>
            )}
          </Popover>
          <Popover label="" icon="more" align="right">
            {(close) => (
              <div className="menu-list static">
                {canDesign && <button type="button" onClick={() => { close(); setModal({ type: 'details' }) }}><Icon name="edit" size={15} />Rename & style</button>}
                {canDesign && <button type="button" onClick={() => { close(); saveSheet({ pinned: !sheet.pinned }, sheet.pinned ? 'Removed from sidebar' : 'Pinned to sidebar').catch((error) => toast(error.message, 'error')) }}><Icon name="pin" size={15} />{sheet.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}</button>}
                <button type="button" onClick={async () => { close(); try { const result = await api(`/api/sheets/${sheet.id}/duplicate`, { method: 'POST', body: { withRows: false } }); await reload(['sheets']); toast('Sheet duplicated'); navigate('sheet', { id: result.sheet.id }) } catch (error) { toast(error.message, 'error') } }}><Icon name="copy" size={15} />Duplicate structure</button>
                <button type="button" onClick={async () => { close(); try { const result = await api(`/api/sheets/${sheet.id}/duplicate`, { method: 'POST', body: { withRows: true } }); await reload(['sheets']); toast('Sheet duplicated with records'); navigate('sheet', { id: result.sheet.id }) } catch (error) { toast(error.message, 'error') } }}><Icon name="columns" size={15} />Duplicate with records</button>
                {canDesign && <button type="button" className="danger" onClick={() => { close(); confirm({ title: `Delete “${sheet.name}”?`, message: `This deletes the sheet and all ${rows.length} records in it.`, onConfirm: async () => { await api(`/api/sheets/${sheet.id}`, { method: 'DELETE' }); await reload(['sheets']); toast('Sheet deleted'); navigate('sheets') } }) }}><Icon name="trash" size={15} />Delete sheet</button>}
              </div>
            )}
          </Popover>
        </div>
      </header>

      <div className="view-tabs" role="tablist" aria-label="Views">
        <button type="button" role="tab" aria-selected={view.id === 'all'} className={view.id === 'all' ? 'active' : ''} onClick={() => setView(blankView)}><Icon name="sheet" size={14} />All records</button>
        {sheet.views.map((item) => (
          <span key={item.id} className={`view-tab${view.id === item.id ? ' active' : ''}`}>
            <button type="button" role="tab" aria-selected={view.id === item.id} onClick={() => setView(item)}><Icon name="eye" size={14} />{item.name}</button>
            {view.id === item.id && canEdit && <button type="button" className="view-x" aria-label={`Remove view ${item.name}`} onClick={() => deleteView(item)}><Icon name="close" size={12} /></button>}
          </span>
        ))}
{canEdit &&         <button type="button" className="view-save" onClick={() => setModal({ type: 'view' })}><Icon name="plus" size={14} />{view.id === 'all' ? 'Save as view' : 'Update view'}</button>}
      </div>

      <div className="sheet-toolbar">
        <label className="ws-search sheet-search">
          <Icon name="search" size={15} />
          <input value={view.search || ''} onChange={(event) => patchView({ search: event.target.value })} placeholder={`Search ${sheet.name.toLowerCase()}…`} aria-label="Search records" />
        </label>
        <Popover label={filtersOn ? `Filtered · ${filtersOn}` : 'Filter'} icon="filter" active={filtersOn > 0} wide>
          <div className="filter-box">
            {(view.filters || []).map((filter, index) => {
              const column = sheet.columns.find((item) => item.id === filter.column) || sheet.columns[0]
              const operators = operatorsFor(column.type)
              const needsValue = !['empty', 'filled', 'checked', 'unchecked'].includes(filter.operator)
              const update = (changes) => patchView({ filters: view.filters.map((item, at) => (at === index ? { ...item, ...changes } : item)) })
              return (
                <div key={index} className="filter-row">
                  <span className="filter-where">{index ? 'and' : 'Where'}</span>
                  <select value={filter.column} onChange={(event) => { const next = sheet.columns.find((item) => item.id === event.target.value); update({ column: next.id, operator: operatorsFor(next.type)[0][0], value: '' }) }}>
                    {sheet.columns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <select value={filter.operator} onChange={(event) => update({ operator: event.target.value })}>
                    {operators.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {needsValue && (column.type === 'select' ? (
                    <select value={filter.value || ''} onChange={(event) => update({ value: event.target.value })}><option value="">—</option>{(column.options || []).map((option) => <option key={option.label}>{option.label}</option>)}</select>
                  ) : column.type === 'person' ? (
                    <select value={filter.value || ''} onChange={(event) => update({ value: event.target.value })}><option value="">—</option>{members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select>
                  ) : (
                    <input type={column.type === 'date' ? 'date' : ['number', 'currency'].includes(column.type) ? 'number' : 'text'} value={filter.value || ''} onChange={(event) => update({ value: event.target.value })} placeholder="Value" />
                  ))}
                  <IconButton icon="close" label="Remove filter" onClick={() => patchView({ filters: view.filters.filter((_item, at) => at !== index) })} />
                </div>
              )
            })}
            {!filtersOn && <p className="muted">No filters. Show only the records you need.</p>}
            <button type="button" className="text-btn" onClick={() => patchView({ filters: [...(view.filters || []), { column: sheet.columns[0].id, operator: operatorsFor(sheet.columns[0].type)[0][0], value: '' }] })}><Icon name="plus" size={14} />Add filter</button>
          </div>
        </Popover>
        <Popover label={view.sort ? `Sorted` : 'Sort'} icon="sort" active={Boolean(view.sort)}>
          <div className="filter-box">
            <select value={view.sort?.column || ''} onChange={(event) => patchView({ sort: event.target.value ? { column: event.target.value, direction: view.sort?.direction || 'asc' } : null })}>
              <option value="">No sorting</option>
              {sheet.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
            </select>
            {view.sort && (
              <div className="segmented small">
                <button type="button" className={view.sort.direction === 'asc' ? 'active' : ''} onClick={() => patchView({ sort: { ...view.sort, direction: 'asc' } })}>A → Z · 1 → 9</button>
                <button type="button" className={view.sort.direction === 'desc' ? 'active' : ''} onClick={() => patchView({ sort: { ...view.sort, direction: 'desc' } })}>Z → A · 9 → 1</button>
              </div>
            )}
          </div>
        </Popover>
        <Popover label={groupColumn ? `Grouped: ${groupColumn.name}` : 'Group'} icon="group" active={Boolean(groupColumn)}>
          {(close) => (
            <div className="menu-list static">
              <button type="button" onClick={() => { patchView({ groupBy: null }); close() }}>{!groupColumn && <Icon name="check" size={14} />}No grouping</button>
              {sheet.columns.filter((column) => ['select', 'person', 'checkbox', 'text', 'date'].includes(column.type)).map((column) => (
                <button key={column.id} type="button" onClick={() => { patchView({ groupBy: column.id }); close() }}>{groupColumn?.id === column.id ? <Icon name="check" size={14} /> : <Icon name={typeInfo[column.type].icon} size={14} />}{column.name}</button>
              ))}
            </div>
          )}
        </Popover>
        <Popover label={view.hidden?.length ? `${view.hidden.length} hidden` : 'Fields'} icon="eye" active={Boolean(view.hidden?.length)}>
          <div className="filter-box fields-box">
            {sheet.columns.map((column) => (
              <label key={column.id} className="check-row">
                <input type="checkbox" checked={!(view.hidden || []).includes(column.id)} onChange={(event) => patchView({ hidden: event.target.checked ? view.hidden.filter((idItem) => idItem !== column.id) : [...(view.hidden || []), column.id] })} />
                <Icon name={typeInfo[column.type].icon} size={14} />{column.name}
              </label>
            ))}
          </div>
        </Popover>
        <span className="toolbar-spacer" />
        {canEdit && <Button variant="primary" icon="plus" onClick={() => addRow()}>New {itemName(sheet).toLowerCase()}</Button>}
      </div>

      {selectedRows.length > 0 && (
        <div className="bulk-bar">
          <strong>{selectedRows.length} selected</strong>
          <button type="button" onClick={async () => toast(await copyText(toTsv(visibleColumns, selectedRows, members)) ? 'Copied — paste anywhere' : 'Copy failed', 'success')}><Icon name="copy" size={15} />Copy</button>
          <button type="button" onClick={() => exportXlsx(`${sheet.name} (selection)`, visibleColumns, selectedRows, members)}><Icon name="download" size={15} />Excel</button>
          <button type="button" onClick={() => exportCsv(`${sheet.name} (selection)`, visibleColumns, selectedRows, members)}><Icon name="download" size={15} />CSV</button>
          {canEdit && <button type="button" className="danger" onClick={() => deleteRows(selectedRows.map((row) => row.id))}><Icon name="trash" size={15} />Delete</button>}
          <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th className="grid-check"><input type="checkbox" aria-label="Select all" checked={allChecked} onChange={toggleAll} /></th>
              {visibleColumns.map((column, index) => (
                <th key={column.id} className={`grid-col type-${column.type}`} style={column.width ? { width: column.width } : undefined}>
                  <div className="col-head">
                    <Icon name={typeInfo[column.type]?.icon || 'text'} size={13} />
                    <span>{column.name}</span>
                    {view.sort?.column === column.id && <Icon name={view.sort.direction === 'asc' ? 'up' : 'down'} size={12} />}
                    <Popover label="" icon="down" align={index > visibleColumns.length - 3 ? 'right' : 'left'}>
                      {(close) => (
                        <div className="menu-list static">
                          {canDesign && <button type="button" onClick={() => { close(); setModal({ type: 'column', column }) }}><Icon name="edit" size={14} />Edit column</button>}
                          <button type="button" onClick={() => { close(); patchView({ sort: { column: column.id, direction: 'asc' } }) }}><Icon name="up" size={14} />Sort ascending</button>
                          <button type="button" onClick={() => { close(); patchView({ sort: { column: column.id, direction: 'desc' } }) }}><Icon name="down" size={14} />Sort descending</button>
                          <button type="button" onClick={() => { close(); patchView({ groupBy: column.id }) }}><Icon name="group" size={14} />Group by this</button>
                          <button type="button" onClick={() => { close(); patchView({ filters: [...(view.filters || []), { column: column.id, operator: operatorsFor(column.type)[0][0], value: '' }] }) }}><Icon name="filter" size={14} />Filter by this</button>
                          <button type="button" onClick={() => { close(); patchView({ hidden: [...(view.hidden || []), column.id] }) }}><Icon name="eye" size={14} />Hide in this view</button>
                          {canDesign && <>
                            <button type="button" onClick={() => { close(); moveColumn(column, -1) }}><Icon name="left" size={14} />Move left</button>
                            <button type="button" onClick={() => { close(); moveColumn(column, 1) }}><Icon name="right" size={14} />Move right</button>
                            <button type="button" onClick={() => { close(); setModal({ type: 'column', index: sheet.columns.findIndex((item) => item.id === column.id) + 1 }) }}><Icon name="plus" size={14} />Insert column after</button>
                            {sheet.columns.length > 1 && <button type="button" className="danger" onClick={() => { close(); deleteColumn(column) }}><Icon name="trash" size={14} />Delete column</button>}
                          </>}
                        </div>
                      )}
                    </Popover>
                  </div>
                </th>
              ))}
              {canDesign && <th className="grid-add"><button type="button" aria-label="Add column" title="Add column" onClick={() => setModal({ type: 'column' })}><Icon name="plus" size={15} /></button></th>}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.key || 'all'}>
              {groupColumn && (
                <tr className="group-row">
                  <td colSpan={visibleColumns.length + 2}>
                    {group.option ? <Chip option={group.option} /> : <strong>{group.label}</strong>}
                    <span className="muted">{group.rows.length}</span>
                  </td>
                </tr>
              )}
              {group.rows.map((row) => (
                <tr key={row.id} className={`${selected.has(row.id) ? 'selected' : ''}${openRow === row.id ? ' open' : ''}`}>
                  <td className="grid-check">
                    <input type="checkbox" aria-label="Select record" checked={selected.has(row.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next })} />
                    <button type="button" className="row-open" aria-label="Open record" title="Open record" onClick={() => setOpenRow(row.id)}><Icon name="expand" size={13} /></button>
                  </td>
                  {visibleColumns.map((column) => {
                    const isEditing = editing?.rowId === row.id && editing.columnId === column.id
                    return (
                      <td key={column.id} className={`grid-cell type-${column.type}${isEditing ? ' editing' : ''}`}
                        onClick={() => { if (!canEdit) { setOpenRow(row.id); return } if (column.type === 'checkbox') updateCell(row, column.id, !row.data[column.id]); else if (!isEditing) setEditing({ rowId: row.id, columnId: column.id }) }}>
                        {isEditing ? (
                          <CellEditor column={column} value={row.data[column.id]} members={members}
                            onCommit={(value) => { setEditing(null); if (JSON.stringify(value ?? null) !== JSON.stringify(row.data[column.id] ?? null)) updateCell(row, column.id, value) }}
                            onCancel={() => setEditing(null)} />
                        ) : <CellView column={column} value={row.data[column.id]} members={members} />}
                      </td>
                    )
                  })}
                  {canDesign && <td className="grid-add" />}
                </tr>
              ))}
              {canEdit && (
                <tr className="add-row">
                  <td colSpan={visibleColumns.length + 2}>
                    <button type="button" onClick={() => addRow(prefillFor(group))}><Icon name="plus" size={14} />New record{groupColumn && group.key ? ` in ${group.label}` : ''}</button>
                  </td>
                </tr>
              )}
            </tbody>
          ))}
          {numberColumns.length > 0 && filtered.length > 0 && (
            <tfoot>
              <tr>
                <td className="grid-check" />
                {visibleColumns.map((column) => {
                  if (!numberColumns.includes(column)) return <td key={column.id} />
                  const total = filtered.reduce((sum, row) => sum + (typeof row.data[column.id] === 'number' ? row.data[column.id] : 0), 0)
                  return <td key={column.id} className="cell-num"><span className="muted">Sum</span> {displayValue(column, total)}</td>
                })}
                {canDesign && <td />}
              </tr>
            </tfoot>
          )}
        </table>
        {!rows.length && (
          <div className="grid-empty">
            <SheetIcon icon={sheet.icon} color={sheet.color} size="lg" />
            <strong>{sheet.name} is ready</strong>
            <p>{canEdit ? 'Add your first record, or import an Excel or CSV file you already have.' : 'No records have been added yet.'}</p>
            {canEdit && <div className="row-gap"><Button variant="primary" icon="plus" onClick={() => addRow()}>New record</Button><Button icon="file_in" onClick={() => setModal({ type: 'import' })}>Import file</Button></div>}
          </div>
        )}
        {rows.length > 0 && !filtered.length && <div className="grid-empty"><strong>No records match this view</strong><Button onClick={() => setView(blankView)}>Clear filters</Button></div>}
      </div>

      {activeRow && <RecordPanel sheet={sheet} row={activeRow} members={members} canEdit={canEdit} canComment={canComment} onChange={updateCell} onDelete={(row) => deleteRows([row.id])} onShare={() => setModal({ type: 'share-record', row: activeRow })} onClose={() => setOpenRow(null)} />}
      {modal?.type === 'share' && <ShareModal type="sheet" id={sheet.id} name={sheet.name} sheet={sheet} onSheetSaved={(changes) => saveSheet(changes)} onClose={() => setModal(null)} />}
      {modal?.type === 'share-record' && <ShareModal type="record" id={modal.row.id} name={displayValue(sheet.columns[0], modal.row.data[sheet.columns[0]?.id], members) || 'this record'} onClose={() => setModal(null)} />}
      {modal?.type === 'column' && <ColumnModal column={modal.column} onSave={(column) => saveColumn(column, modal.index)} onClose={() => setModal(null)} />}
      {modal?.type === 'view' && (
        <Modal title={view.id === 'all' ? 'Save view' : 'Update view'} onClose={() => setModal(null)} width={420}>
          <form onSubmit={(event) => { event.preventDefault(); const name = new FormData(event.currentTarget).get('name').trim(); if (name) { saveCurrentView(name); setModal(null) } }}>
            <div className="modal-body stack-sm">
              <p className="confirm-text">Keeps the current search, filters, sort, grouping and hidden fields as a tab everyone on the team can use.</p>
              <Field label="View name"><input name="name" required maxLength={40} defaultValue={view.id === 'all' ? '' : view.name} placeholder="e.g. Available in Lekki" /></Field>
            </div>
            <div className="modal-foot"><Button onClick={() => setModal(null)}>Cancel</Button><Button type="submit" variant="primary">Save view</Button></div>
          </form>
        </Modal>
      )}
      {modal?.type === 'details' && <DetailsModal sheet={sheet} onSave={(changes) => saveSheet(changes, 'Sheet updated')} onClose={() => setModal(null)} />}
      {modal?.type === 'import' && <ImportModal sheet={sheet} canDesign={canDesign} onClose={() => setModal(null)} onImported={async (count) => { await load(); reload(['sheets']); toast(`${count.toLocaleString()} records imported`) }} />}
    </div>
  )
}

export default Sheet
