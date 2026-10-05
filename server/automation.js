import { pool } from './db.js'
import { clean, readable } from './sheet-values.js'

// OVO Automations: "WHEN something happens, DO these things", built without code.
//
// Triggers (automation.trigger.type):
//   record_created  { sheetId }                       a record is added (by hand, Create, a form or an automation)
//   record_updated  { sheetId, columnId, value? }     a field changes (optionally: to this value)
//   task_completed  {}                                any task is marked Completed
//   project_status  { value }                         a project's status changes to value
//   client_created  {}                                a client is added
//
// Actions (automation.actions[]):
//   create_task { title, description?, assignee: { mode: none|fixed|column|actor, userId?, columnId? }, dueInDays?, priority? }
//   notify      { to: { mode: fixed|column|managers|actor, userIds?, columnId? }, message }
//   set_field   { columnId, value }                  (record triggers only; never re-triggers automations)
//
// Text fields accept {{placeholders}}: any column name for record triggers, plus {{sheet}};
// {{task}} and {{assignee}} for tasks; {{project}} and {{status}} for projects;
// {{client}}, {{contact}} and {{email}} for clients.

export const TRIGGERS = ['record_created', 'record_updated', 'task_completed', 'project_status', 'client_created']
export const ACTIONS = ['create_task', 'notify', 'set_field']
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']

function matches(trigger, event) {
  if (trigger.type !== event.type) return false
  switch (event.type) {
    case 'record_created':
      return trigger.sheetId === event.sheet.id
    case 'record_updated': {
      if (trigger.sheetId !== event.sheet.id || !(trigger.columnId in event.changes)) return false
      if (trigger.value === undefined || trigger.value === null || trigger.value === '') return true
      const column = event.sheet.columns.find((item) => item.id === trigger.columnId)
      if (!column) return false
      const now = event.row.data[trigger.columnId]
      return String(column.type === 'checkbox' ? (now ? 'Yes' : 'No') : now ?? '').toLowerCase() === String(trigger.value).toLowerCase()
    }
    case 'project_status':
      return !trigger.value || trigger.value === event.project.status
    default:
      return true
  }
}

async function memberNames(db, organizationId) {
  const result = await db.query(
    `SELECT u.id, u.full_name FROM organization_members om JOIN users u ON u.id = om.user_id WHERE om.organization_id = $1`,
    [organizationId],
  )
  return new Map(result.rows.map((row) => [row.id, row.full_name]))
}

function placeholders(event, members) {
  const values = {}
  if (event.sheet && event.row) {
    values.sheet = event.sheet.name
    for (const column of event.sheet.columns) values[column.name.toLowerCase()] = readable(column, event.row.data[column.id], members)
    const first = event.sheet.columns[0]
    values.record = first ? readable(first, event.row.data[first.id], members) : ''
  }
  if (event.task) Object.assign(values, { task: event.task.title, assignee: event.task.assigneeName || '', status: event.task.status })
  if (event.project) Object.assign(values, { project: event.project.name, status: event.project.status })
  if (event.client) Object.assign(values, { client: event.client.name, contact: event.client.contactName || '', email: event.client.email || '' })
  return values
}

function fill(template, values) {
  return String(template || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key) => values[key.toLowerCase()] ?? '').trim()
}

// Where a notification or task created by this event should point.
function linkFor(event) {
  if (event.sheet && event.row) return `#/sheet?id=${event.sheet.id}&record=${event.row.id}`
  if (event.task) return '#/tasks'
  if (event.project) return '#/projects'
  if (event.client) return '#/clients'
  return null
}

// Resolves "who" from an action's settings to member ids of this workspace.
function resolvePeople(target, event, members, managers) {
  if (!target) return []
  if (target.mode === 'fixed') return (target.userIds || (target.userId ? [target.userId] : [])).filter((id) => members.has(id))
  if (target.mode === 'actor') return event.actorId && members.has(event.actorId) ? [event.actorId] : []
  if (target.mode === 'managers') return managers
  if (target.mode === 'column' && event.row) {
    const id = event.row.data[target.columnId]
    return typeof id === 'string' && members.has(id) ? [id] : []
  }
  return []
}

async function runActions(automation, event, context) {
  const { members, managers } = context
  const values = placeholders(event, members)
  const link = linkFor(event)
  const done = []
  for (const action of automation.actions) {
    if (action.type === 'create_task') {
      const creator = event.actorId && members.has(event.actorId) ? event.actorId : automation.created_by
      if (!creator) throw new Error('No one to record as the task’s creator.')
      const assignee = resolvePeople(action.assignee, event, members, managers)[0] || null
      const due = Number.isInteger(action.dueInDays) ? new Date(Date.now() + action.dueInDays * 86_400_000).toISOString().slice(0, 10) : null
      const title = fill(action.title, values).slice(0, 200) || 'Follow up'
      const task = await pool.query(
        `INSERT INTO tasks (organization_id, title, description, priority, status, due_date, assignee_id, created_by)
         VALUES ($1, $2, $3, $4, 'To Do', $5, $6, $7) RETURNING id`,
        [automation.organization_id, title, fill(action.description, values).slice(0, 2000),
          PRIORITIES.includes(action.priority) ? action.priority : 'Medium', due, assignee, creator],
      )
      if (assignee) {
        await pool.query(
          `INSERT INTO notifications (organization_id, user_id, title, message, resource_type, resource_id, link)
           VALUES ($1, $2, 'New task for you', $3, 'task', $4, '#/tasks')`,
          [automation.organization_id, assignee, `“${title}” — created by the automation “${automation.name}”.`, task.rows[0].id],
        )
      }
      done.push(`created task “${title}”${assignee ? ` for ${members.get(assignee)}` : ''}`)
    } else if (action.type === 'notify') {
      const people = resolvePeople(action.to, event, members, managers)
      const message = fill(action.message, values).slice(0, 1000) || `“${automation.name}” ran.`
      for (const userId of people) {
        await pool.query(
          `INSERT INTO notifications (organization_id, user_id, title, message, resource_type, link)
           VALUES ($1, $2, $3, $4, 'automation', $5)`,
          [automation.organization_id, userId, automation.name.slice(0, 120), message, link],
        )
      }
      done.push(`notified ${people.length} ${people.length === 1 ? 'person' : 'people'}`)
    } else if (action.type === 'set_field') {
      if (!event.row || !event.sheet) continue
      const column = event.sheet.columns.find((item) => item.id === action.columnId)
      if (!column) throw new Error('The field to set no longer exists.')
      const changes = clean({ [column.id]: action.value }, [column])
      await pool.query('UPDATE sheet_rows SET data = data || $1, updated_at = now() WHERE id = $2', [JSON.stringify(changes), event.row.id])
      await pool.query(
        `INSERT INTO sheet_row_events (row_id, organization_id, kind, body) VALUES ($1, $2, 'updated', $3)`,
        [event.row.id, automation.organization_id, `${column.name} → ${readable(column, changes[column.id], members) || 'empty'} (automation “${automation.name}”)`],
      )
      event.row.data = { ...event.row.data, ...changes }
      done.push(`set ${column.name}`)
    }
  }
  return done.join(', ') || 'nothing to do'
}

// Runs every enabled automation that matches the event. Never throws: a failing automation
// is recorded on its run history and must not break the action that triggered it.
export async function runAutomations(event) {
  try {
    const automations = await pool.query(
      `SELECT id, organization_id, name, trigger, actions, created_by FROM automations
       WHERE organization_id = $1 AND enabled AND trigger->>'type' = $2`,
      [event.organizationId, event.type],
    )
    const matching = automations.rows.filter((automation) => matches(automation.trigger, event))
    if (!matching.length) return
    const members = await memberNames(pool, event.organizationId)
    const managerRows = await pool.query(
      `SELECT user_id FROM organization_members WHERE organization_id = $1 AND role IN ('owner', 'admin', 'manager')`,
      [event.organizationId],
    )
    const context = { members, managers: managerRows.rows.map((row) => row.user_id) }
    for (const automation of matching) {
      let status = 'success'
      let detail
      try {
        detail = await runActions(automation, event, context)
      } catch (error) {
        status = 'error'
        detail = error.message || 'Something went wrong.'
      }
      await pool.query(
        `INSERT INTO automation_runs (automation_id, organization_id, status, detail) VALUES ($1, $2, $3, $4)`,
        [automation.id, event.organizationId, status, detail.slice(0, 500)],
      )
      await pool.query(
        `UPDATE automations SET run_count = run_count + 1, last_run_at = now(), last_error = $1 WHERE id = $2`,
        [status === 'error' ? detail.slice(0, 500) : null, automation.id],
      )
    }
  } catch (error) {
    console.warn('Automations failed to run:', error.message)
  }
}
