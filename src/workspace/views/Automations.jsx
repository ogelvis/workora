import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Button, Empty, Field, IconButton, Modal, PageHeader } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { formatDateTime, timeAgo } from '../../lib/format.js'
import { projectStatuses } from '../../lib/constants.js'
import { useWorkspace } from '../context.js'
import { SheetIcon } from './Sheets.jsx'

const TRIGGERS = [
  { type: 'record_created', label: 'A record is added', hint: 'By hand, from Create, or through a form', icon: 'sheet', record: true },
  { type: 'record_updated', label: 'A record’s field changes', hint: 'Optionally only when it changes to a value', icon: 'edit', record: true },
  { type: 'task_completed', label: 'A task is completed', hint: 'Any task in the workspace', icon: 'tasks' },
  { type: 'project_status', label: 'A project’s status changes', hint: 'For example to Completed', icon: 'projects' },
  { type: 'client_created', label: 'A client is added', hint: 'From the Clients page or Create', icon: 'clients' },
]
const ACTIONS = [
  { type: 'create_task', label: 'Create a task', icon: 'tasks', tone: 'green' },
  { type: 'notify', label: 'Notify people', icon: 'bell', tone: 'violet' },
  { type: 'set_field', label: 'Update a field', icon: 'edit', tone: 'amber', record: true },
]
const newAction = (type) => (type === 'create_task'
  ? { type, title: '', assignee: { mode: 'none' }, dueInDays: 1, priority: 'Medium' }
  : type === 'notify' ? { type, to: { mode: 'managers' }, message: '' } : { type, columnId: '', value: '' })

// Starting points people can adjust, per the most common business routines.
const RECIPES = [
  { name: 'Follow up every new record', icon: 'clock', describe: 'When a record is added, create a follow-up task for the person in charge.', build: (sheet) => ({
    name: `Follow up new ${sheet?.name || 'records'}`, trigger: { type: 'record_created', sheetId: sheet?.id || '' },
    actions: [{ type: 'create_task', title: 'Follow up: {{record}}', assignee: { mode: 'actor' }, dueInDays: 1, priority: 'High' }],
  }) },
  { name: 'Tell managers about new records', icon: 'bell', describe: 'Notify owners, admins and managers whenever something new comes in.', build: (sheet) => ({
    name: `New in ${sheet?.name || 'a sheet'}`, trigger: { type: 'record_created', sheetId: sheet?.id || '' },
    actions: [{ type: 'notify', to: { mode: 'managers' }, message: 'New in {{sheet}}: {{record}}' }],
  }) },
  { name: 'Project completed', icon: 'projects', describe: 'When a project is completed, notify the managers.', build: () => ({
    name: 'Project completed', trigger: { type: 'project_status', value: 'Completed' },
    actions: [{ type: 'notify', to: { mode: 'managers' }, message: '{{project}} is now Completed.' }],
  }) },
  { name: 'Welcome new clients', icon: 'clients', describe: 'When a client is added, create an onboarding task.', build: () => ({
    name: 'Onboard new clients', trigger: { type: 'client_created' },
    actions: [{ type: 'create_task', title: 'Onboard {{client}}', assignee: { mode: 'actor' }, dueInDays: 2, priority: 'Medium' }],
  }) },
]

function useSheetColumns(sheetId) {
  const [columns, setColumns] = useState([])
  useEffect(() => {
    if (!sheetId) { setColumns([]); return }
    api(`/api/sheets/${sheetId}`).then((result) => setColumns(result.sheet.columns)).catch(() => setColumns([]))
  }, [sheetId])
  return columns
}

function PeoplePicker({ value, onChange, columns, record, allowNone, label }) {
  const { data } = useWorkspace()
  const personColumns = columns.filter((column) => column.type === 'person')
  return (
    <div className="ab-people">
      <Field label={label}>
        <select value={value.mode} onChange={(event) => onChange({ mode: event.target.value })}>
          {allowNone && <option value="none">No one (unassigned)</option>}
          <option value="actor">The person who triggered it</option>
          <option value="managers">All owners, admins and managers</option>
          <option value="fixed">Specific people…</option>
          {record && personColumns.length > 0 && <option value="column">The person in a field…</option>}
        </select>
      </Field>
      {value.mode === 'fixed' && (
        <div className="ab-chips">
          {data.members.map((member) => {
            const ids = value.userIds || (value.userId ? [value.userId] : [])
            const on = ids.includes(member.id)
            return (
              <button key={member.id} type="button" className={`chip ${on ? 'tone-violet' : 'tone-slate'}`}
                onClick={() => onChange({ mode: 'fixed', userIds: on ? ids.filter((id) => id !== member.id) : [...ids, member.id], userId: on ? undefined : member.id })}>
                {on && <Icon name="check" size={12} />}{member.fullName}
              </button>
            )
          })}
        </div>
      )}
      {value.mode === 'column' && (
        <Field label="Field">
          <select value={value.columnId || ''} onChange={(event) => onChange({ mode: 'column', columnId: event.target.value })}>
            <option value="">Choose…</option>
            {personColumns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
          </select>
        </Field>
      )}
    </div>
  )
}

function Placeholders({ trigger, columns, onPick }) {
  const keys = trigger.type.startsWith('record_')
    ? ['record', 'sheet', ...columns.map((column) => column.name)]
    : trigger.type === 'task_completed' ? ['task', 'assignee'] : trigger.type === 'project_status' ? ['project', 'status'] : ['client', 'contact', 'email']
  return (
    <div className="ab-ph">
      <span>Insert:</span>
      {keys.map((key) => <button key={key} type="button" onClick={() => onPick(`{{${key}}}`)}>{`{{${key}}}`}</button>)}
    </div>
  )
}

function Builder({ automation, onSaved, onClose }) {
  const { data, toast } = useWorkspace()
  const sheets = data.sheets.filter((sheet) => sheet.permission === 'full')
  const [draft, setDraft] = useState(() => automation
    ? { name: automation.name, trigger: { ...automation.trigger }, actions: automation.actions.map((action) => ({ ...action })), enabled: automation.enabled }
    : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const columns = useSheetColumns(draft?.trigger.sheetId)
  const triggerInfo = TRIGGERS.find((item) => item.type === draft?.trigger.type)
  const record = Boolean(triggerInfo?.record)

  if (!draft) {
    return (
      <Modal title="New automation" eyebrow="OVO Automations" onClose={onClose} width={720}>
        <div className="modal-body stack-sm">
          <p className="confirm-text">Start from a recipe and adjust it, or build your own.</p>
          <div className="ab-recipes">
            {RECIPES.map((recipe) => (
              <button key={recipe.name} type="button" onClick={() => setDraft({ ...recipe.build(sheets[0]), enabled: true })}>
                <span className="create-icon tone-violet"><Icon name={recipe.icon} size={16} /></span>
                <span><strong>{recipe.name}</strong><small>{recipe.describe}</small></span>
              </button>
            ))}
            <button type="button" onClick={() => setDraft({ name: '', trigger: { type: 'record_created', sheetId: sheets[0]?.id || '' }, actions: [newAction('create_task')], enabled: true })}>
              <span className="create-icon tone-slate"><Icon name="plus" size={16} /></span>
              <span><strong>Start from scratch</strong><small>Choose your own WHEN and DO.</small></span>
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  const setTrigger = (changes) => setDraft((current) => ({ ...current, trigger: { ...current.trigger, ...changes } }))
  const setAction = (index, changes) => setDraft((current) => ({ ...current, actions: current.actions.map((action, at) => (at === index ? { ...action, ...changes } : action)) }))

  async function save() {
    setBusy(true)
    setError('')
    const trigger = { type: draft.trigger.type }
    if (record) Object.assign(trigger, { sheetId: draft.trigger.sheetId })
    if (draft.trigger.type === 'record_updated') Object.assign(trigger, { columnId: draft.trigger.columnId, value: draft.trigger.value || undefined })
    if (draft.trigger.type === 'project_status' && draft.trigger.value) trigger.value = draft.trigger.value
    const actions = draft.actions.map((action) => {
      if (action.type === 'create_task') return { ...action, dueInDays: action.dueInDays === '' || action.dueInDays === null ? null : Number(action.dueInDays) }
      if (action.type === 'set_field') {
        const column = columns.find((item) => item.id === action.columnId)
        const value = column?.type === 'checkbox' ? action.value === true || action.value === 'true' : column && ['number', 'currency'].includes(column.type) && action.value !== '' ? Number(action.value) : action.value
        return { ...action, value }
      }
      return action
    })
    try {
      const body = { name: draft.name || 'Untitled automation', enabled: draft.enabled, trigger, actions }
      const result = automation
        ? await api(`/api/automations/${automation.id}`, { method: 'PUT', body })
        : await api('/api/automations', { method: 'POST', body })
      toast(automation ? 'Automation saved' : 'Automation is on')
      onSaved(result.automation)
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={automation ? 'Edit automation' : 'New automation'} eyebrow="OVO Automations" onClose={onClose} width={760} busy={busy}>
      <div className="modal-body stack-sm">
        <Field label="Name"><input value={draft.name} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Follow up new clients" /></Field>

        <section className="ab-step ab-when">
          <span className="ab-tag">WHEN</span>
          <div className="stack-sm">
            <div className="ab-triggers">
              {TRIGGERS.map((item) => (
                <button key={item.type} type="button" className={draft.trigger.type === item.type ? 'active' : ''}
                  onClick={() => setDraft((current) => ({ ...current, trigger: { type: item.type, sheetId: item.record ? (current.trigger.sheetId || sheets[0]?.id || '') : undefined }, actions: item.record ? current.actions : current.actions.filter((action) => action.type !== 'set_field').map((action) => (action.assignee?.mode === 'column' ? { ...action, assignee: { mode: 'actor' } } : action.to?.mode === 'column' ? { ...action, to: { mode: 'managers' } } : action)) }))}>
                  <Icon name={item.icon} size={16} /><span><strong>{item.label}</strong><small>{item.hint}</small></span>
                </button>
              ))}
            </div>
            {record && (
              <div className="form-grid">
                <Field label="In sheet">
                  <select value={draft.trigger.sheetId || ''} onChange={(event) => setTrigger({ sheetId: event.target.value, columnId: undefined })}>
                    <option value="" disabled>Choose…</option>
                    {sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}
                  </select>
                </Field>
                {draft.trigger.type === 'record_updated' && (() => {
                  const column = columns.find((item) => item.id === draft.trigger.columnId)
                  return <>
                    <Field label="Field">
                      <select value={draft.trigger.columnId || ''} onChange={(event) => setTrigger({ columnId: event.target.value, value: '' })}>
                        <option value="" disabled>Choose…</option>
                        {columns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </Field>
                    {column && (
                      <Field label="Changes to" hint="Leave as “any value” to run on every change.">
                        {column.type === 'select' ? (
                          <select value={draft.trigger.value || ''} onChange={(event) => setTrigger({ value: event.target.value })}>
                            <option value="">Any value</option>
                            {(column.options || []).map((option) => <option key={option.label}>{option.label}</option>)}
                          </select>
                        ) : column.type === 'checkbox' ? (
                          <select value={draft.trigger.value || ''} onChange={(event) => setTrigger({ value: event.target.value })}>
                            <option value="">Any value</option><option>Yes</option><option>No</option>
                          </select>
                        ) : <input value={draft.trigger.value || ''} maxLength={500} onChange={(event) => setTrigger({ value: event.target.value })} placeholder="Any value" />}
                      </Field>
                    )}
                  </>
                })()}
              </div>
            )}
            {draft.trigger.type === 'project_status' && (
              <Field label="Changes to">
                <select value={draft.trigger.value || ''} onChange={(event) => setTrigger({ value: event.target.value })}>
                  <option value="">Any status</option>
                  {projectStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </Field>
            )}
          </div>
        </section>

        {draft.actions.map((action, index) => {
          const info = ACTIONS.find((item) => item.type === action.type)
          return (
            <section key={index} className="ab-step ab-do">
              <span className="ab-tag">{index ? 'AND' : 'DO'}</span>
              <div className="stack-sm">
                <div className="ab-action-head">
                  <span className={`create-icon tone-${info.tone}`}><Icon name={info.icon} size={15} /></span>
                  <select value={action.type} onChange={(event) => setDraft((current) => ({ ...current, actions: current.actions.map((item, at) => (at === index ? newAction(event.target.value) : item)) }))}>
                    {ACTIONS.filter((item) => !item.record || record).map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
                  </select>
                  {draft.actions.length > 1 && <IconButton icon="trash" label="Remove step" onClick={() => setDraft((current) => ({ ...current, actions: current.actions.filter((_item, at) => at !== index) }))} />}
                </div>
                {action.type === 'create_task' && <>
                  <Field label="Task title"><input value={action.title} maxLength={200} onChange={(event) => setAction(index, { title: event.target.value })} placeholder="e.g. Call {{record}}" /></Field>
                  <Placeholders trigger={draft.trigger} columns={columns} onPick={(text) => setAction(index, { title: `${action.title}${action.title ? ' ' : ''}${text}` })} />
                  <div className="form-grid">
                    <PeoplePicker label="Assign to" value={action.assignee} columns={columns} record={record} allowNone onChange={(assignee) => setAction(index, { assignee })} />
                    <div className="form-grid">
                      <Field label="Due in (days)"><input type="number" min={0} max={365} value={action.dueInDays ?? ''} onChange={(event) => setAction(index, { dueInDays: event.target.value === '' ? null : Number(event.target.value) })} placeholder="No due date" /></Field>
                      <Field label="Priority"><select value={action.priority || 'Medium'} onChange={(event) => setAction(index, { priority: event.target.value })}>{['Low', 'Medium', 'High', 'Urgent'].map((item) => <option key={item}>{item}</option>)}</select></Field>
                    </div>
                  </div>
                </>}
                {action.type === 'notify' && <>
                  <PeoplePicker label="Who" value={action.to} columns={columns} record={record} onChange={(to) => setAction(index, { to })} />
                  <Field label="Message"><textarea rows={2} maxLength={1000} value={action.message} onChange={(event) => setAction(index, { message: event.target.value })} placeholder="e.g. New lead: {{record}}" /></Field>
                  <Placeholders trigger={draft.trigger} columns={columns} onPick={(text) => setAction(index, { message: `${action.message}${action.message ? ' ' : ''}${text}` })} />
                </>}
                {action.type === 'set_field' && (() => {
                  const column = columns.find((item) => item.id === action.columnId)
                  return (
                    <div className="form-grid">
                      <Field label="Set field">
                        <select value={action.columnId} onChange={(event) => setAction(index, { columnId: event.target.value, value: '' })}>
                          <option value="" disabled>Choose…</option>
                          {columns.filter((item) => item.type !== 'person').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                      </Field>
                      <Field label="To">
                        {column?.type === 'select' ? (
                          <select value={action.value ?? ''} onChange={(event) => setAction(index, { value: event.target.value })}>
                            <option value="">Empty</option>{(column.options || []).map((option) => <option key={option.label}>{option.label}</option>)}
                          </select>
                        ) : column?.type === 'checkbox' ? (
                          <select value={String(action.value)} onChange={(event) => setAction(index, { value: event.target.value === 'true' })}><option value="true">Checked</option><option value="false">Unchecked</option></select>
                        ) : <input type={column?.type === 'date' ? 'date' : ['number', 'currency'].includes(column?.type) ? 'number' : 'text'} value={action.value ?? ''} maxLength={500} onChange={(event) => setAction(index, { value: event.target.value })} />}
                      </Field>
                    </div>
                  )
                })()}
              </div>
            </section>
          )
        })}
        {draft.actions.length < 10 && <button type="button" className="text-btn" onClick={() => setDraft((current) => ({ ...current, actions: [...current.actions, newAction('notify')] }))}><Icon name="plus" size={14} />Add another step</button>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-foot">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="bolt" onClick={save} disabled={busy}>{busy ? 'Saving…' : automation ? 'Save automation' : 'Turn on automation'}</Button>
      </div>
    </Modal>
  )
}

function describeWhen(automation, sheetsById, columnsBySheet) {
  const { trigger } = automation
  const sheet = sheetsById[trigger.sheetId]
  const where = sheet ? sheet.name : 'a sheet'
  if (trigger.type === 'record_created') return <>a record is added to <b>{where}</b></>
  if (trigger.type === 'record_updated') {
    const column = (columnsBySheet[trigger.sheetId] || []).find((item) => item.id === trigger.columnId)
    return <><b>{column?.name || 'a field'}</b> changes{trigger.value ? <> to <b>{trigger.value}</b></> : ''} in <b>{where}</b></>
  }
  if (trigger.type === 'task_completed') return <>a <b>task</b> is completed</>
  if (trigger.type === 'project_status') return <>a project becomes <b>{trigger.value || 'any status'}</b></>
  return <>a <b>client</b> is added</>
}

function describeDo(action, members, columns) {
  const who = (target) => target?.mode === 'managers' ? 'managers' : target?.mode === 'actor' ? 'whoever triggered it' : target?.mode === 'column' ? `the ${columns.find((column) => column.id === target.columnId)?.name || 'assigned person'}` : target?.mode === 'fixed' ? (target.userIds || [target.userId]).map((id) => members.find((member) => member.id === id)?.fullName).filter(Boolean).join(', ') || 'chosen people' : 'no one'
  if (action.type === 'create_task') return <>create task <b>“{action.title}”</b>{action.assignee?.mode !== 'none' && <> for <b>{who(action.assignee)}</b></>}{Number.isInteger(action.dueInDays) && <>, due in {action.dueInDays} {action.dueInDays === 1 ? 'day' : 'days'}</>}</>
  if (action.type === 'notify') return <>notify <b>{who(action.to)}</b></>
  return <>set <b>{columns.find((column) => column.id === action.columnId)?.name || 'a field'}</b> to <b>{String(action.value ?? 'empty')}</b></>
}

function Runs({ id }) {
  const [runs, setRuns] = useState(null)
  useEffect(() => { api(`/api/automations/${id}/runs`).then((result) => setRuns(result.runs)).catch(() => setRuns([])) }, [id])
  if (!runs) return <p className="muted-note">Loading…</p>
  if (!runs.length) return <p className="muted-note">It hasn’t run yet.</p>
  return (
    <ul className="ab-runs">
      {runs.map((run) => (
        <li key={run.id} className={run.status}><Icon name={run.status === 'success' ? 'check' : 'alert'} size={13} /><span>{run.detail}</span><small>{formatDateTime(run.createdAt)}</small></li>
      ))}
    </ul>
  )
}

function Automations() {
  const { data, toast, confirm } = useWorkspace()
  const [state, setState] = useState(null)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(null)
  const [columnsBySheet, setColumnsBySheet] = useState({})
  const sheetsById = useMemo(() => Object.fromEntries(data.sheets.map((sheet) => [sheet.id, sheet])), [data.sheets])

  const load = useCallback(() => {
    api('/api/automations').then(setState).catch((error) => toast(error.message, 'error'))
  }, [toast])
  useEffect(() => { load() }, [load])

  // Column names make the sentences readable; fetch each referenced sheet once.
  useEffect(() => {
    const ids = [...new Set((state?.automations || []).map((automation) => automation.trigger.sheetId).filter(Boolean))].filter((id) => !(id in columnsBySheet) && sheetsById[id])
    ids.forEach((id) => api(`/api/sheets/${id}`).then((result) => setColumnsBySheet((current) => ({ ...current, [id]: result.sheet.columns }))).catch(() => {}))
  }, [state, columnsBySheet, sheetsById])

  async function toggle(automation) {
    try {
      await api(`/api/automations/${automation.id}`, { method: 'PATCH', body: { enabled: !automation.enabled } })
      toast(automation.enabled ? 'Automation paused' : 'Automation is on')
      load()
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  function remove(automation) {
    confirm({ title: `Delete “${automation.name}”?`, message: 'It stops running straight away. Things it already did stay as they are.', onConfirm: async () => { await api(`/api/automations/${automation.id}`, { method: 'DELETE' }); toast('Automation deleted'); load() } })
  }

  const canManage = state?.canManage
  return (
    <div className="stack">
      <PageHeader eyebrow="Workspace / Automations" title="Automations" description="Let OVO handle the routine: when something happens, it creates tasks, notifies people or updates records for you.">
        {canManage && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New automation</Button>}
      </PageHeader>
      {!state ? <div className="card chart-skeleton" /> : !state.automations.length ? (
        <Empty icon="bolt" title="No automations yet" action={canManage && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Create your first automation</Button>}>
          {canManage ? 'For example: when a new client is added, create a follow-up task and assign it to the agent.' : 'Managers can set up automations for the team.'}
        </Empty>
      ) : (
        <div className="ab-list">
          {state.automations.map((automation) => {
            const sheet = sheetsById[automation.trigger.sheetId]
            const columns = columnsBySheet[automation.trigger.sheetId] || []
            return (
              <article key={automation.id} className={`ab-card${automation.enabled ? '' : ' paused'}`}>
                <div className="ab-card-head">
                  <span className="ab-card-icon"><Icon name="bolt" size={18} /></span>
                  <div><h3>{automation.name}</h3><small>{automation.enabled ? 'On' : 'Paused'} · ran {automation.runCount} {automation.runCount === 1 ? 'time' : 'times'}{automation.lastRunAt ? `, last ${timeAgo(automation.lastRunAt)}` : ''}</small></div>
                  {canManage && <>
                    <button type="button" role="switch" aria-checked={automation.enabled} aria-label={automation.enabled ? 'Pause' : 'Turn on'} className={`switch${automation.enabled ? ' on' : ''}`} onClick={() => toggle(automation)}><i /></button>
                    <IconButton icon="edit" label="Edit" onClick={() => setEditing(automation)} />
                    <IconButton icon="trash" label="Delete" onClick={() => remove(automation)} />
                  </>}
                </div>
                <div className="ab-sentence">
                  <p><span className="ab-tag">WHEN</span>{sheet && <SheetIcon icon={sheet.icon} color={sheet.color} size="sm" />}{describeWhen(automation, sheetsById, columnsBySheet)}</p>
                  {automation.actions.map((action, index) => (
                    <p key={index}><span className="ab-tag do">{index ? 'AND' : 'DO'}</span>{describeDo(action, data.members, columns)}</p>
                  ))}
                </div>
                {automation.lastError && <div className="notice notice-warning"><Icon name="alert" size={15} /><span>Last run had a problem: {automation.lastError}</span></div>}
                <button type="button" className="text-btn" onClick={() => setOpen(open === automation.id ? null : automation.id)}><Icon name={open === automation.id ? 'up' : 'down'} size={14} />Run history</button>
                {open === automation.id && <Runs id={automation.id} />}
              </article>
            )
          })}
        </div>
      )}
      {editing && <Builder automation={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

export default Automations
