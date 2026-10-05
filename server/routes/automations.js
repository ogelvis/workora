import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { HttpError, MANAGERS, logActivity, route } from '../lib.js'
import { TRIGGERS } from '../automation.js'
import { loadSheet } from './sheets.js'

// Managers build automations; everyone else can see what runs in their workspace.
const router = express.Router()
router.use(requireAuth)

const columnRef = z.string().regex(/^c_[a-z0-9]{4,20}$/)
const people = z.object({
  mode: z.enum(['none', 'fixed', 'column', 'actor', 'managers']),
  userId: z.uuid().optional(),
  userIds: z.array(z.uuid()).max(50).optional(),
  columnId: columnRef.optional(),
})
const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_task'),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    assignee: people,
    dueInDays: z.number().int().min(0).max(365).nullable().optional(),
    priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(),
  }),
  z.object({ type: z.literal('notify'), to: people, message: z.string().trim().min(1).max(1000) }),
  z.object({ type: z.literal('set_field'), columnId: columnRef, value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]) }),
])
const automationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional(),
  trigger: z.object({
    type: z.enum(TRIGGERS),
    sheetId: z.uuid().optional(),
    columnId: columnRef.optional(),
    value: z.string().max(500).optional(),
  }),
  actions: z.array(actionSchema).min(1).max(10),
})

function managersOnly(request, response, next) {
  if (!MANAGERS.includes(request.auth.role)) return response.status(403).json({ error: 'Only owners, admins and managers can change automations.' })
  return next()
}

// Record triggers need a sheet the person can fully manage, and real columns.
async function validate(values, auth) {
  const recordTrigger = values.trigger.type.startsWith('record_')
  if (recordTrigger) {
    if (!values.trigger.sheetId) throw new HttpError(400, 'Choose the sheet this automation watches.')
    const sheet = await loadSheet(pool, values.trigger.sheetId, auth, { need: 'full' })
    const ids = new Set(sheet.columns.map((column) => column.id))
    if (values.trigger.type === 'record_updated' && !ids.has(values.trigger.columnId)) throw new HttpError(400, 'Choose which field to watch.')
    for (const action of values.actions) {
      const refs = [action.columnId, action.assignee?.columnId, action.to?.columnId].filter(Boolean)
      if (refs.some((id) => !ids.has(id))) throw new HttpError(400, 'An action points to a field that isn’t in this sheet.')
    }
  } else if (values.actions.some((action) => action.type === 'set_field' || action.assignee?.mode === 'column' || action.to?.mode === 'column')) {
    throw new HttpError(400, 'Only record automations can use fields from the record.')
  }
  const members = await pool.query('SELECT user_id FROM organization_members WHERE organization_id = $1', [auth.organizationId])
  const memberIds = new Set(members.rows.map((row) => row.user_id))
  const chosen = values.actions.flatMap((action) => [action.assignee?.userId, ...(action.to?.userIds || [])]).filter(Boolean)
  if (chosen.some((id) => !memberIds.has(id))) throw new HttpError(400, 'Choose people who are in this workspace.')
}

const columns = `a.id, a.name, a.enabled, a.trigger, a.actions, a.run_count AS "runCount", a.last_run_at AS "lastRunAt",
  a.last_error AS "lastError", a.created_at AS "createdAt", u.full_name AS "createdBy"`

router.get('/automations', route(async (request, response) => {
  const result = await pool.query(
    `SELECT ${columns} FROM automations a LEFT JOIN users u ON u.id = a.created_by
     WHERE a.organization_id = $1 ORDER BY a.created_at DESC`,
    [request.auth.organizationId],
  )
  return response.json({ automations: result.rows, canManage: MANAGERS.includes(request.auth.role) })
}))

router.post('/automations', managersOnly, route(async (request, response) => {
  const values = automationSchema.parse(request.body)
  await validate(values, request.auth)
  const count = await pool.query('SELECT count(*)::int AS count FROM automations WHERE organization_id = $1', [request.auth.organizationId])
  if (count.rows[0].count >= 100) throw new HttpError(400, 'A workspace can have up to 100 automations.')
  const result = await pool.query(
    `INSERT INTO automations (organization_id, name, enabled, trigger, actions, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [request.auth.organizationId, values.name, values.enabled ?? true, JSON.stringify(values.trigger), JSON.stringify(values.actions), request.auth.userId],
  )
  await logActivity(pool, request.auth, 'created automation', 'automation', values.name)
  const automation = await pool.query(`SELECT ${columns} FROM automations a LEFT JOIN users u ON u.id = a.created_by WHERE a.id = $1`, [result.rows[0].id])
  return response.status(201).json({ automation: automation.rows[0] })
}))

router.put('/automations/:id', managersOnly, route(async (request, response) => {
  const values = automationSchema.parse(request.body)
  await validate(values, request.auth)
  const result = await pool.query(
    `UPDATE automations SET name = $1, enabled = $2, trigger = $3, actions = $4, last_error = NULL, updated_at = now()
     WHERE id = $5 AND organization_id = $6 RETURNING id`,
    [values.name, values.enabled ?? true, JSON.stringify(values.trigger), JSON.stringify(values.actions), request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) throw new HttpError(404, 'Automation not found.')
  const automation = await pool.query(`SELECT ${columns} FROM automations a LEFT JOIN users u ON u.id = a.created_by WHERE a.id = $1`, [request.params.id])
  return response.json({ automation: automation.rows[0] })
}))

router.patch('/automations/:id', managersOnly, route(async (request, response) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body)
  const result = await pool.query(
    'UPDATE automations SET enabled = $1, updated_at = now() WHERE id = $2 AND organization_id = $3 RETURNING name',
    [enabled, request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) throw new HttpError(404, 'Automation not found.')
  await logActivity(pool, request.auth, enabled ? 'turned on automation' : 'paused automation', 'automation', result.rows[0].name)
  return response.json({ ok: true })
}))

router.delete('/automations/:id', managersOnly, route(async (request, response) => {
  const result = await pool.query('DELETE FROM automations WHERE id = $1 AND organization_id = $2 RETURNING name', [request.params.id, request.auth.organizationId])
  if (!result.rowCount) throw new HttpError(404, 'Automation not found.')
  await logActivity(pool, request.auth, 'deleted automation', 'automation', result.rows[0].name)
  return response.status(204).end()
}))

router.get('/automations/:id/runs', route(async (request, response) => {
  const result = await pool.query(
    `SELECT r.id, r.status, r.detail, r.created_at AS "createdAt" FROM automation_runs r
     JOIN automations a ON a.id = r.automation_id
     WHERE r.automation_id = $1 AND a.organization_id = $2 ORDER BY r.created_at DESC LIMIT 25`,
    [request.params.id, request.auth.organizationId],
  )
  return response.json({ runs: result.rows })
}))

export default router
