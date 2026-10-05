import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Button, Empty, Field, IconButton, Modal, PageHeader, copyText } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { timeAgo } from '../../lib/format.js'
import { COLUMN_TYPES } from '../../../shared/industries.js'
import { useWorkspace } from '../context.js'
import { SHEET_COLORS, SheetIcon } from './Sheets.jsx'

const typeIcon = Object.fromEntries(COLUMN_TYPES.map((column) => [column.type, column.icon]))
const formUrl = (token) => `${window.location.origin}/f/${token}`

// Build or edit a form: pick the sheet it feeds, the questions and how it looks.
function FormBuilder({ form, onSaved, onClose }) {
  const { data, toast, account } = useWorkspace()
  const sheets = data.sheets.filter((sheet) => sheet.permission === 'full')
  const [sheetId, setSheetId] = useState(form?.sheetId || sheets[0]?.id || '')
  const [columns, setColumns] = useState([])
  const [fields, setFields] = useState(form?.fields || [])
  const [title, setTitle] = useState(form?.title || '')
  const [description, setDescription] = useState(form?.description || '')
  const [color, setColor] = useState(form?.color || 'violet')
  const [submitMessage, setSubmitMessage] = useState(form?.submitMessage || 'Thank you! Your response has been received.')
  const [notifyTeam, setNotifyTeam] = useState(form?.notify ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sheetId) return
    api(`/api/sheets/${sheetId}`).then((result) => {
      const usable = result.sheet.columns.filter((column) => column.type !== 'person')
      setColumns(usable)
      if (!form || form.sheetId !== sheetId) {
        // A new form asks every field by default; the first one is required.
        setFields(usable.slice(0, 8).map((column, index) => ({ columnId: column.id, label: column.name, required: index === 0, help: '' })))
        if (!form) {
          setTitle((current) => current || `${result.sheet.name} form`)
          setColor(result.sheet.color || 'violet')
        }
      }
    }).catch((requestError) => setError(requestError.message))
  }, [sheetId, form])

  const included = new Set(fields.map((field) => field.columnId))
  const update = (columnId, changes) => setFields((current) => current.map((field) => (field.columnId === columnId ? { ...field, ...changes } : field)))
  const move = (index, step) => setFields((current) => {
    const next = [...current]
    const target = index + step
    if (target < 0 || target >= next.length) return current
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })

  async function save() {
    if (!fields.length) { setError('Add at least one question.'); return }
    setBusy(true)
    setError('')
    try {
      const body = { title, description, color, fields, submitMessage, notify: notifyTeam }
      const result = form
        ? await api(`/api/forms/${form.id}`, { method: 'PUT', body })
        : await api('/api/forms', { method: 'POST', body: { ...body, sheetId } })
      toast(form ? 'Form saved' : 'Form created — share its link to start collecting responses')
      onSaved(result.form)
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }

  if (!sheets.length) {
    return (
      <Modal title="New form" onClose={onClose} width={480}>
        <div className="modal-body"><p className="confirm-text">Forms add records to a sheet. Create a sheet first, or ask a manager to give you full access to one.</p></div>
        <div className="modal-foot"><Button onClick={onClose}>Close</Button></div>
      </Modal>
    )
  }

  return (
    <Modal title={form ? 'Edit form' : 'New form'} eyebrow="OVO Forms" onClose={onClose} width={1040} busy={busy}>
      <div className="modal-body form-builder">
        <div className="fb-edit stack-sm">
          {!form && (
            <Field label="Answers go into">
              <select value={sheetId} onChange={(event) => setSheetId(event.target.value)}>
                {sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Form title"><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. New Client Form" /></Field>
          <Field label="Introduction"><textarea rows={2} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Tell people what this form is for" /></Field>
          <div className="field">
            <span className="field-label">Questions</span>
            <ul className="fb-fields">
              {fields.map((field, index) => {
                const column = columns.find((item) => item.id === field.columnId)
                if (!column) return null
                return (
                  <li key={field.columnId}>
                    <span className="fb-type" title={column.type}><Icon name={typeIcon[column.type] || 'text'} size={14} /></span>
                    <div className="fb-field-main">
                      <input value={field.label} maxLength={120} onChange={(event) => update(field.columnId, { label: event.target.value })} aria-label="Question" />
                      <input className="fb-help" value={field.help || ''} maxLength={300} onChange={(event) => update(field.columnId, { help: event.target.value })} placeholder="Help text (optional)" aria-label="Help text" />
                    </div>
                    <label className="fb-req"><input type="checkbox" checked={Boolean(field.required)} onChange={(event) => update(field.columnId, { required: event.target.checked })} />Required</label>
                    <IconButton icon="up" label="Move up" disabled={!index} onClick={() => move(index, -1)} />
                    <IconButton icon="down" label="Move down" disabled={index === fields.length - 1} onClick={() => move(index, 1)} />
                    <IconButton icon="close" label="Remove question" onClick={() => setFields((current) => current.filter((item) => item.columnId !== field.columnId))} />
                  </li>
                )
              })}
            </ul>
            {columns.some((column) => !included.has(column.id)) && (
              <div className="fb-add">
                <span>Add a question:</span>
                {columns.filter((column) => !included.has(column.id)).map((column) => (
                  <button key={column.id} type="button" className="chip tone-slate" onClick={() => setFields((current) => [...current, { columnId: column.id, label: column.name, required: false, help: '' }])}>
                    <Icon name="plus" size={12} />{column.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="form-grid">
            <div className="field"><span className="field-label">Colour</span><div className="swatches">
              {SHEET_COLORS.map((name) => <button key={name} type="button" className={`swatch tone-${name}${color === name ? ' active' : ''}`} onClick={() => setColor(name)} aria-label={name} />)}
            </div></div>
            <Field label="After someone submits"><input value={submitMessage} maxLength={500} onChange={(event) => setSubmitMessage(event.target.value)} /></Field>
          </div>
          <label className="check-row"><input type="checkbox" checked={notifyTeam} onChange={(event) => setNotifyTeam(event.target.checked)} /> Notify managers and the sheet’s owner about each response</label>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className={`fb-preview tone-${color}`} aria-label="Preview">
          <span className="fb-preview-label">Preview</span>
          <div className="fb-preview-card">
            <div className="fb-preview-head"><small>{account.organization.name}</small><strong>{title || 'Untitled form'}</strong>{description && <p>{description}</p>}</div>
            <div className="fb-preview-body">
              {fields.map((field) => {
                const column = columns.find((item) => item.id === field.columnId)
                if (!column) return null
                return (
                  <div key={field.columnId} className="fb-preview-field">
                    <span>{field.label}{field.required && <em>*</em>}</span>
                    {field.help && <small>{field.help}</small>}
                    {column.type === 'select' ? (
                      <div className="fb-preview-options">{(column.options || []).slice(0, 5).map((option) => <i key={option.label}>{option.label}</i>)}</div>
                    ) : column.type === 'checkbox' ? <div className="fb-preview-check" /> : <div className={`fb-preview-input${column.type === 'longtext' ? ' tall' : ''}`} />}
                  </div>
                )
              })}
              <div className="fb-preview-submit">Submit</div>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="check" onClick={save} disabled={busy || !title.trim()}>{busy ? 'Saving…' : form ? 'Save form' : 'Create form'}</Button>
      </div>
    </Modal>
  )
}

function Forms() {
  const { toast, confirm, navigate } = useWorkspace()
  const [forms, setForms] = useState(null)
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => {
    api('/api/forms').then((result) => setForms(result.forms)).catch((error) => toast(error.message, 'error'))
  }, [toast])
  useEffect(() => { load() }, [load])

  async function toggle(form) {
    try {
      await api(`/api/forms/${form.id}`, { method: 'PUT', body: { active: !form.active } })
      toast(form.active ? 'Form closed to new responses' : 'Form is accepting responses')
      load()
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  function remove(form) {
    confirm({
      title: `Delete “${form.title}”?`,
      message: 'The link will stop working. Responses already collected stay in the sheet.',
      onConfirm: async () => { await api(`/api/forms/${form.id}`, { method: 'DELETE' }); toast('Form deleted'); load() },
    })
  }

  return (
    <div className="stack">
      <PageHeader eyebrow="Workspace / Forms" title="Forms" description="Collect information without spreadsheets or email. Every response becomes a record in the sheet you choose.">
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New form</Button>
      </PageHeader>
      <div className="flow-strip">
        <span><Icon name="form" size={15} />Form</span><Icon name="right" size={14} />
        <span><Icon name="sheet" size={15} />Record in a sheet</span><Icon name="right" size={14} />
        <span><Icon name="bolt" size={15} />Automations</span><Icon name="right" size={14} />
        <span><Icon name="tasks" size={15} />Tasks & notifications</span>
      </div>
      {!forms ? <div className="card chart-skeleton" /> : !forms.length ? (
        <Empty icon="form" title="No forms yet" action={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Create your first form</Button>}>
          A client brief, a property enquiry or a student registration — share one link and responses arrive as records.
        </Empty>
      ) : (
        <div className="form-grid-cards">
          {forms.map((form) => (
            <article key={form.id} className={`form-card tone-${form.color}${form.active ? '' : ' closed'}`}>
              <div className="form-card-top">
                <span className="form-card-icon"><Icon name="form" size={20} /></span>
                <span className={`form-status${form.active ? ' on' : ''}`}>{form.active ? 'Accepting responses' : 'Closed'}</span>
              </div>
              <h3>{form.title}</h3>
              <button type="button" className="form-card-sheet" onClick={() => navigate('sheet', { id: form.sheetId })}><SheetIcon icon={form.sheetIcon} color={form.sheetColor} size="sm" />{form.sheetName}</button>
              <div className="form-card-stats">
                <span><b>{form.submissionCount}</b> {form.submissionCount === 1 ? 'response' : 'responses'}</span>
                <span>{form.lastSubmissionAt ? `Last ${timeAgo(form.lastSubmissionAt)}` : 'No responses yet'}</span>
              </div>
              <div className="form-card-link">
                <input readOnly value={formUrl(form.token)} onFocus={(event) => event.target.select()} aria-label="Form link" />
                <IconButton icon="copy" label="Copy link" onClick={async () => toast(await copyText(formUrl(form.token)) ? 'Form link copied' : 'Copy the link manually')} />
                <a className="icon-btn" href={formUrl(form.token)} target="_blank" rel="noreferrer" title="Open form" aria-label="Open form"><Icon name="expand" size={16} /></a>
              </div>
              {form.canManage && (
                <div className="form-card-actions">
                  <Button size="sm" icon="edit" onClick={() => setEditing(form)}>Edit</Button>
                  <Button size="sm" icon={form.active ? 'pause' : 'play'} onClick={() => toggle(form)}>{form.active ? 'Close' : 'Reopen'}</Button>
                  <IconButton icon="trash" label="Delete form" onClick={() => remove(form)} />
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {editing && <FormBuilder form={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

export default Forms
