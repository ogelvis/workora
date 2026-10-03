import { useState } from 'react'
import { Button, Field, Modal } from './ui.jsx'
import { toLocalInput } from '../lib/format.js'
import {
  campaignStatuses, clientStatuses, eventTypes, priorities, projectStatuses, recordTypes, taskStatuses,
} from '../lib/constants.js'


function Options({ items, empty }) {
  return (
    <>
      {empty !== undefined && <option value="">{empty}</option>}
      {items.map((item) => typeof item === 'string'
        ? <option key={item} value={item}>{item}</option>
        : <option key={item.id} value={item.id}>{item.name || item.fullName}</option>)}
    </>
  )
}

function collect(type, form) {
  const values = Object.fromEntries(new FormData(form).entries())
  if (type === 'campaign') {
    values.platforms = values.platforms ? values.platforms.split(',').map((item) => item.trim()).filter(Boolean) : []
    for (const key of ['budget', 'revenue', 'leadsGenerated', 'conversions']) values[key] = values[key] ? Number(values[key]) : 0
  }
  if (type === 'event') {
    values.startsAt = new Date(values.startsAt).toISOString()
    values.endsAt = values.endsAt ? new Date(values.endsAt).toISOString() : null
  }
  return values
}

/**
 * Create or edit a workspace record. `record` is the existing row when editing,
 * or an object of defaults when creating.
 */
export function RecordForm({ type, record = {}, lookups = {}, onSubmit, onClose }) {
  const { noun } = recordTypes[type]
  const editing = Boolean(record.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit(collect(type, event.currentTarget))
      onClose()
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }

  const { clients = [], projects = [], members = [] } = lookups

  return (
    <Modal title={editing ? `Edit ${noun}` : `New ${noun}`} eyebrow={editing ? record.name || record.title : 'Workspace'} onClose={onClose} busy={busy} width={type === 'campaign' ? 680 : 560}>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          {type === 'client' && <>
            <Field label="Client name" wide><input name="name" required maxLength={160} defaultValue={record.name} /></Field>
            <Field label="Contact person"><input name="contactName" maxLength={120} defaultValue={record.contactName} /></Field>
            <Field label="Email"><input name="email" type="email" defaultValue={record.email} /></Field>
            <Field label="Industry"><input name="industry" maxLength={120} defaultValue={record.industry} placeholder="Retail, hospitality…" /></Field>
            <Field label="Status"><select name="status" defaultValue={record.status || 'Lead'}><Options items={clientStatuses} /></select></Field>
          </>}

          {type === 'project' && <>
            <Field label="Project name" wide><input name="name" required maxLength={160} defaultValue={record.name} /></Field>
            <Field label="Description" wide><textarea name="description" rows={3} maxLength={5000} defaultValue={record.description} /></Field>
            <Field label="Client"><select name="clientId" defaultValue={record.clientId || ''}><Options items={clients} empty="No client" /></select></Field>
            <Field label="Due date"><input name="dueDate" type="date" defaultValue={record.dueDate || ''} /></Field>
            <Field label="Status"><select name="status" defaultValue={record.status || 'Planning'}><Options items={projectStatuses} /></select></Field>
          </>}

          {type === 'task' && <>
            <Field label="Task title" wide><input name="title" required maxLength={240} defaultValue={record.title} /></Field>
            <Field label="Description" wide><textarea name="description" rows={3} maxLength={5000} defaultValue={record.description} /></Field>
            <Field label="Assignee"><select name="assigneeId" defaultValue={record.assigneeId || ''}><Options items={members} empty="Unassigned" /></select></Field>
            <Field label="Project"><select name="projectId" defaultValue={record.projectId || ''}><Options items={projects} empty="No project" /></select></Field>
            <Field label="Priority"><select name="priority" defaultValue={record.priority || 'Medium'}><Options items={priorities} /></select></Field>
            <Field label="Status"><select name="status" defaultValue={record.status || 'To Do'}><Options items={taskStatuses} /></select></Field>
            <Field label="Due date"><input name="dueDate" type="date" defaultValue={record.dueDate || ''} /></Field>
          </>}

          {type === 'campaign' && <>
            <Field label="Campaign name" wide><input name="name" required maxLength={160} defaultValue={record.name} /></Field>
            <Field label="Objective" wide><textarea name="objective" rows={2} maxLength={2000} defaultValue={record.objective} /></Field>
            <Field label="Campaign type"><input name="campaignType" maxLength={80} defaultValue={record.campaignType === 'Other' ? '' : record.campaignType} placeholder="Social, email, events…" /></Field>
            <Field label="Client"><select name="clientId" defaultValue={record.clientId || ''}><Options items={clients} empty="No client" /></select></Field>
            <Field label="Status"><select name="status" defaultValue={record.status || 'Planning'}><Options items={campaignStatuses} /></select></Field>
            <Field label="Platforms" hint="Separate with commas"><input name="platforms" defaultValue={(record.platforms || []).join(', ')} placeholder="Instagram, Email" /></Field>
            <Field label="Start date"><input name="startDate" type="date" defaultValue={record.startDate || ''} /></Field>
            <Field label="End date"><input name="endDate" type="date" defaultValue={record.endDate || ''} /></Field>
            <Field label="Target audience" wide><input name="targetAudience" maxLength={1000} defaultValue={record.targetAudience} /></Field>
            <Field label="Budget"><input name="budget" type="number" min="0" step="0.01" defaultValue={record.budget ?? ''} /></Field>
            <Field label="Revenue"><input name="revenue" type="number" min="0" step="0.01" defaultValue={record.revenue ?? ''} /></Field>
            <Field label="Leads generated"><input name="leadsGenerated" type="number" min="0" step="1" defaultValue={record.leadsGenerated ?? ''} /></Field>
            <Field label="Conversions"><input name="conversions" type="number" min="0" step="1" defaultValue={record.conversions ?? ''} /></Field>
            <Field label="Results & notes" wide><textarea name="results" rows={2} maxLength={3000} defaultValue={record.results} /></Field>
          </>}

          {type === 'event' && <>
            <Field label="Event title" wide><input name="title" required maxLength={160} defaultValue={record.title} /></Field>
            <Field label="Starts"><input name="startsAt" type="datetime-local" required defaultValue={toLocalInput(record.startsAt)} /></Field>
            <Field label="Ends"><input name="endsAt" type="datetime-local" defaultValue={toLocalInput(record.endsAt)} /></Field>
            <Field label="Type"><select name="eventType" defaultValue={record.eventType || 'Meeting'}><Options items={eventTypes} /></select></Field>
            <Field label="Project"><select name="projectId" defaultValue={record.projectId || ''}><Options items={projects} empty="No project" /></select></Field>
            <Field label="Client"><select name="clientId" defaultValue={record.clientId || ''}><Options items={clients} empty="No client" /></select></Field>
            <Field label="Details" wide><textarea name="description" rows={3} maxLength={3000} defaultValue={record.description} /></Field>
          </>}
          {error && <p className="form-error field-wide" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : `Create ${noun}`}</button>
        </div>
      </form>
    </Modal>
  )
}
