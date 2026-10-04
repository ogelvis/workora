import { useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Button, Field, Modal, PageHeader } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { timeAgo } from '../../lib/format.js'
import { INDUSTRIES, SHEET_TEMPLATES, industryFor } from '../../../shared/industries.js'
import { useWorkspace } from '../context.js'

export const SHEET_ICONS = ['sheet', 'clients', 'building', 'deal', 'money', 'box', 'truck', 'calendar', 'student', 'heart', 'chart', 'target', 'team', 'pin', 'clock', 'briefcase', 'scale', 'video']
export const SHEET_COLORS = ['violet', 'blue', 'sky', 'teal', 'green', 'amber', 'orange', 'rose', 'pink', 'indigo']

export function SheetIcon({ icon, color, size = 'md' }) {
  return <span className={`sheet-icon sheet-icon-${size} tone-${color || 'violet'}`}><Icon name={icon || 'sheet'} size={size === 'lg' ? 22 : size === 'sm' ? 14 : 18} /></span>
}

// Create a sheet from scratch or from a template, then open it.
export function NewSheetModal({ initialTemplate = '', onClose }) {
  const { account, reload, navigate, toast } = useWorkspace()
  const industry = industryFor(account.organization.industry)
  const [template, setTemplate] = useState(initialTemplate)
  const [icon, setIcon] = useState('sheet')
  const [color, setColor] = useState('violet')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)

  const suggested = industry.modules
  const others = Object.keys(SHEET_TEMPLATES).filter((key) => !suggested.includes(key))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    try {
      const body = template
        ? { name: values.name || SHEET_TEMPLATES[template].name, templateKey: template, pinned: values.pinned === 'on' }
        : { name: values.name, description: values.description, icon, color, pinned: values.pinned === 'on' }
      const result = await api('/api/sheets', { method: 'POST', body })
      await reload(['sheets'])
      toast('Sheet created')
      onClose()
      navigate('sheet', { id: result.sheet.id })
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }

  const chosen = template && SHEET_TEMPLATES[template]
  return (
    <Modal title="New sheet" eyebrow="OVO Sheets" onClose={onClose} width={720} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body stack-sm">
          <div className="template-pick">
            <button type="button" className={`template-card${!template ? ' active' : ''}`} onClick={() => setTemplate('')}>
              <SheetIcon icon="plus" color="slate" />
              <span><strong>Blank sheet</strong><small>Start with five simple columns</small></span>
            </button>
            {(showAll ? [...suggested, ...others] : suggested).map((key) => (
              <button key={key} type="button" className={`template-card${template === key ? ' active' : ''}`} onClick={() => setTemplate(key)}>
                <SheetIcon icon={SHEET_TEMPLATES[key].icon} color={SHEET_TEMPLATES[key].color} />
                <span><strong>{SHEET_TEMPLATES[key].name}</strong><small>{SHEET_TEMPLATES[key].description}</small></span>
              </button>
            ))}
          </div>
          {!showAll && <button type="button" className="text-btn" onClick={() => setShowAll(true)}>Show templates for every industry</button>}
          <div className="form-grid">
            <Field label="Sheet name"><input name="name" key={template} required={!template} maxLength={80} placeholder={chosen ? chosen.name : 'e.g. Supplier Database'} defaultValue={chosen ? chosen.name : ''} /></Field>
            {!template && <Field label="Description"><input name="description" maxLength={300} placeholder="What is this sheet for?" /></Field>}
          </div>
          {!template && (
            <div className="form-grid">
              <div className="field">
                <span className="field-label">Icon</span>
                <div className="swatches">
                  {SHEET_ICONS.map((name) => (
                    <button key={name} type="button" className={`swatch-icon${icon === name ? ' active' : ''}`} onClick={() => setIcon(name)} aria-label={name}><Icon name={name} size={16} /></button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">Colour</span>
                <div className="swatches">
                  {SHEET_COLORS.map((name) => (
                    <button key={name} type="button" className={`swatch tone-${name}${color === name ? ' active' : ''}`} onClick={() => setColor(name)} aria-label={name} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <label className="check-row"><input type="checkbox" name="pinned" defaultChecked /> Show it in the sidebar as a module</label>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" icon="plus" disabled={busy}>{busy ? 'Creating…' : 'Create sheet'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function Sheets() {
  const { account, data, search } = useWorkspace()
  const [creating, setCreating] = useState(null)
  const industry = industryFor(account.organization.industry)
  const query = search.trim().toLowerCase()
  const sheets = data.sheets.filter((sheet) => !query || `${sheet.name} ${sheet.description}`.toLowerCase().includes(query))
  const records = data.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0)

  // Templates for this industry the workspace hasn't added yet.
  const missing = useMemo(
    () => industry.modules.filter((key) => !data.sheets.some((sheet) => sheet.templateKey === key)),
    [industry, data.sheets],
  )

  return (
    <div className="stack">
      <PageHeader eyebrow="Workspace / Sheets" title="OVO Sheets" description="Your business records: a spreadsheet, a database and a shared workspace in one.">
        <Button variant="primary" icon="plus" onClick={() => setCreating('')}>New sheet</Button>
      </PageHeader>

      <div className="sheet-summary">
        <div><strong>{data.sheets.length}</strong><span>sheets</span></div>
        <div><strong>{records.toLocaleString()}</strong><span>records</span></div>
        <div><strong>{data.sheets.filter((sheet) => sheet.pinned).length}</strong><span>pinned as modules</span></div>
      </div>

      {sheets.length ? (
        <div className="sheet-grid">
          {sheets.map((sheet) => (
            <a key={sheet.id} href={`#/sheet?id=${sheet.id}`} className={`sheet-card tone-${sheet.color}`}>
              <div className="sheet-card-top">
                <SheetIcon icon={sheet.icon} color={sheet.color} size="lg" />
                {sheet.pinned && <span className="sheet-pin" title="In the sidebar"><Icon name="pin" size={13} />Module</span>}
              </div>
              <strong>{sheet.name}</strong>
              <p>{sheet.description || 'Custom sheet'}</p>
              <div className="sheet-card-foot">
                <span><b>{sheet.rowCount.toLocaleString()}</b> records</span>
                <span><b>{sheet.columnCount}</b> columns</span>
                <span>{timeAgo(sheet.lastEditedAt || sheet.updatedAt)}</span>
              </div>
            </a>
          ))}
          <button type="button" className="sheet-card sheet-card-new" onClick={() => setCreating('')}>
            <span className="empty-icon"><Icon name="plus" size={22} /></span>
            <strong>New sheet</strong>
            <p>Client database, inventory, attendance — anything your business tracks.</p>
          </button>
        </div>
      ) : (
        <div className="empty"><span className="empty-icon"><Icon name="sheet" size={22} /></span><strong>No sheets match</strong><p>Try another search.</p></div>
      )}

      {missing.length > 0 && (
        <section className="card suggest-card">
          <div className="card-head">
            <div><h2>Suggested for {INDUSTRIES.find((item) => item.key === industry.key)?.label}</h2><p>Ready-made modules other {industry.label.toLowerCase()} businesses use. Add one in a click and adjust it to fit.</p></div>
          </div>
          <div className="template-pick">
            {missing.map((key) => (
              <button key={key} type="button" className="template-card" onClick={() => setCreating(key)}>
                <SheetIcon icon={SHEET_TEMPLATES[key].icon} color={SHEET_TEMPLATES[key].color} />
                <span><strong>{SHEET_TEMPLATES[key].name}</strong><small>{SHEET_TEMPLATES[key].description}</small></span>
                <Icon name="plus" size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
      {creating !== null && <NewSheetModal initialTemplate={creating} onClose={() => setCreating(null)} />}
    </div>
  )
}

export default Sheets
