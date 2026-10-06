import { randomBytes } from 'node:crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { HttpError, MANAGERS, assertPlanCount, logActivity, notify, route, withTransaction } from '../lib.js'
import { clean } from '../sheet-values.js'
import { runAutomations } from '../automation.js'
import { loadSheet } from './sheets.js'

// OVO Forms: no-code forms whose answers land as records in a sheet.
export const publicFormRouter = express.Router()
const router = express.Router()
router.use(requireAuth)

const COLORS = ['violet', 'blue', 'sky', 'teal', 'green', 'amber', 'orange', 'rose', 'pink', 'indigo']
const fieldSchema = z.object({
  columnId: z.string().regex(/^c_[a-z0-9]{4,20}$/),
  label: z.string().trim().min(1).max(120),
  help: z.string().trim().max(300).optional(),
  required: z.boolean().optional(),
})
const formSchema = z.object({
  sheetId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  fields: z.array(fieldSchema).min(1).max(60),
  color: z.enum(COLORS).optional(),
  active: z.boolean().optional(),
  submitMessage: z.string().trim().max(500).optional(),
  notify: z.boolean().optional(),
})

const formColumns = `f.id, f.sheet_id AS "sheetId", s.name AS "sheetName", s.icon AS "sheetIcon", s.color AS "sheetColor",
  f.title, f.description, f.fields, f.color, f.token, f.active, f.submit_message AS "submitMessage", f.notify,
  f.submission_count AS "submissionCount", f.last_submission_at AS "lastSubmissionAt", f.created_at AS "createdAt"`

// Forms are managed by people with full access to the sheet they feed.
async function loadForm(db, id, auth) {
  const result = await db.query(
    `SELECT ${formColumns} FROM forms f JOIN sheets s ON s.id = f.sheet_id WHERE f.id = $1 AND f.organization_id = $2`,
    [id, auth.organizationId],
  )
  if (!result.rowCount) throw new HttpError(404, 'Form not found.')
  await loadSheet(db, result.rows[0].sheetId, auth, { need: 'full' })
  return result.rows[0]
}

function checkFields(fields, sheet) {
  const ids = new Set(sheet.columns.map((column) => column.id))
  if (fields.some((field) => !ids.has(field.columnId))) throw new HttpError(400, 'A form field points to a column that no longer exists.')
  if (new Set(fields.map((field) => field.columnId)).size !== fields.length) throw new HttpError(400, 'Each column can appear in the form once.')
}

router.get('/forms', route(async (request, response) => {
  const result = await pool.query(
    `SELECT ${formColumns}, s.access, s.created_by AS "sheetCreatorId" FROM forms f JOIN sheets s ON s.id = f.sheet_id
     WHERE f.organization_id = $1 ORDER BY f.created_at DESC`,
    [request.auth.organizationId],
  )
  // Everyone can see a form's link; only managers or the sheet's full-access people change it.
  const forms = result.rows.map(({ access: _access, sheetCreatorId, ...form }) => ({
    ...form, canManage: MANAGERS.includes(request.auth.role) || sheetCreatorId === request.auth.userId,
  }))
  return response.json({ forms })
}))

router.post('/forms', route(async (request, response) => {
  const values = formSchema.parse(request.body)
  const sheet = await loadSheet(pool, values.sheetId, request.auth, { need: 'full' })
  checkFields(values.fields, sheet)
  await assertPlanCount(pool, request.auth.organizationId, 'forms', 'forms', 'form')
  const token = randomBytes(9).toString('base64url')
  const result = await pool.query(
    `INSERT INTO forms (organization_id, sheet_id, title, description, fields, color, token, active, submit_message, notify, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [request.auth.organizationId, sheet.id, values.title, values.description || '', JSON.stringify(values.fields), values.color || sheet.color,
      token, values.active ?? true, values.submitMessage || 'Thank you! Your response has been received.', values.notify ?? true, request.auth.userId],
  )
  await logActivity(pool, request.auth, 'created form', 'form', values.title)
  return response.status(201).json({ form: await loadForm(pool, result.rows[0].id, request.auth) })
}))

router.put('/forms/:id', route(async (request, response) => {
  const values = formSchema.omit({ sheetId: true }).partial().parse(request.body)
  const form = await loadForm(pool, request.params.id, request.auth)
  if (values.fields) {
    const sheet = await loadSheet(pool, form.sheetId, request.auth, { need: 'full' })
    checkFields(values.fields, sheet)
  }
  await pool.query(
    `UPDATE forms SET title = $1, description = $2, fields = $3, color = $4, active = $5, submit_message = $6, notify = $7, updated_at = now()
     WHERE id = $8`,
    [values.title ?? form.title, values.description ?? form.description, JSON.stringify(values.fields ?? form.fields), values.color ?? form.color,
      values.active ?? form.active, values.submitMessage ?? form.submitMessage, values.notify ?? form.notify, form.id],
  )
  return response.json({ form: await loadForm(pool, form.id, request.auth) })
}))

router.delete('/forms/:id', route(async (request, response) => {
  const form = await loadForm(pool, request.params.id, request.auth)
  await pool.query('DELETE FROM forms WHERE id = $1', [form.id])
  await logActivity(pool, request.auth, 'deleted form', 'form', form.title)
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Public form pages

const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many submissions from this connection. Please try again in a few minutes.' },
})

async function publicForm(token) {
  const result = await pool.query(
    `SELECT f.id, f.organization_id, f.sheet_id, f.title, f.description, f.fields, f.color, f.active, f.submit_message, f.notify, f.created_by,
            s.columns, s.name AS sheet_name, s.created_by AS sheet_creator, o.name AS organization_name
     FROM forms f JOIN sheets s ON s.id = f.sheet_id JOIN organizations o ON o.id = f.organization_id
     LEFT JOIN subscriptions sub ON sub.organization_id = f.organization_id
     WHERE f.token = $1 AND COALESCE(sub.status, 'trial') != 'suspended'`,
    [token],
  )
  return result.rows[0]
}

publicFormRouter.get('/public/forms/:token', route(async (request, response) => {
  const form = await publicForm(request.params.token)
  if (!form) return response.status(404).json({ error: 'This form doesn’t exist or has been removed.' })
  // Only the fields the form shows, with what a respondent needs to answer them.
  const fields = form.fields
    .map((field) => {
      const column = form.columns.find((item) => item.id === field.columnId)
      if (!column) return null
      return {
        columnId: column.id, label: field.label, help: field.help || '', required: Boolean(field.required), type: column.type,
        options: column.type === 'select' ? (column.options || []).map((option) => option.label) : undefined,
      }
    })
    .filter((field) => field && field.type !== 'person')
  return response.json({
    form: { title: form.title, description: form.description, color: form.color, active: form.active, organizationName: form.organization_name, fields },
  })
}))

publicFormRouter.post('/public/forms/:token', submitLimiter, route(async (request, response) => {
  const form = await publicForm(request.params.token)
  if (!form) return response.status(404).json({ error: 'This form doesn’t exist or has been removed.' })
  if (!form.active) return response.status(410).json({ error: 'This form is no longer accepting responses.' })
  const body = z.object({ answers: z.record(z.string().max(40), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()])), website: z.string().optional() }).parse(request.body)
  // A hidden "website" field catches bots; pretend all is well.
  if (body.website) return response.json({ message: form.submit_message })
  const allowed = form.fields
    .map((field) => ({ field, column: form.columns.find((column) => column.id === field.columnId) }))
    .filter(({ column }) => column && column.type !== 'person')
  const data = clean(Object.fromEntries(allowed.map(({ column }) => [column.id, body.answers[column.id] ?? null])), allowed.map(({ column }) => column))
  const missing = allowed.filter(({ field, column }) => field.required && (data[column.id] === null || data[column.id] === undefined || data[column.id] === '' || (column.type === 'checkbox' && !data[column.id])))
  if (missing.length) return response.status(400).json({ error: `Please answer: ${missing.map(({ field }) => field.label).join(', ')}.` })
  if (allowed.some(({ column }) => column.type === 'select' && data[column.id] && !(column.options || []).some((option) => option.label === data[column.id]))) {
    return response.status(400).json({ error: 'Please choose one of the listed options.' })
  }
  const row = await withTransaction(async (client) => {
    const stats = await client.query('SELECT COALESCE(max(position), 0) AS last FROM sheet_rows WHERE sheet_id = $1', [form.sheet_id])
    const inserted = await client.query(
      `INSERT INTO sheet_rows (sheet_id, organization_id, data, position) VALUES ($1, $2, $3, $4)
       RETURNING id, data, position, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [form.sheet_id, form.organization_id, JSON.stringify(data), Number(stats.rows[0].last) + 1],
    )
    await client.query(
      `INSERT INTO sheet_row_events (row_id, organization_id, kind, body) VALUES ($1, $2, 'created', $3)`,
      [inserted.rows[0].id, form.organization_id, `Submitted through the form “${form.title}”`],
    )
    await client.query('UPDATE forms SET submission_count = submission_count + 1, last_submission_at = now() WHERE id = $1', [form.id])
    await client.query('UPDATE sheets SET updated_at = now() WHERE id = $1', [form.sheet_id])
    if (form.notify) {
      const people = await client.query(
        `SELECT DISTINCT user_id FROM organization_members
         WHERE organization_id = $1 AND (role IN ('owner', 'admin', 'manager') OR user_id = $2 OR user_id = $3)`,
        [form.organization_id, form.sheet_creator, form.created_by],
      )
      const first = form.columns[0]
      const name = first && data[first.id] ? ` from ${String(data[first.id]).slice(0, 60)}` : ''
      for (const person of people.rows) {
        await notify(client, form.organization_id, person.user_id, {
          title: `New response: ${form.title}`.slice(0, 120),
          message: `A new response${name} was added to ${form.sheet_name}.`,
          resourceType: 'form',
          resourceId: form.id,
          link: `#/sheet?id=${form.sheet_id}&record=${inserted.rows[0].id}`,
        })
      }
    }
    return inserted.rows[0]
  })
  await runAutomations({
    organizationId: form.organization_id, actorId: null, type: 'record_created', sheet: { id: form.sheet_id, name: form.sheet_name, columns: form.columns }, row,
  })
  return response.status(201).json({ message: form.submit_message })
}))

export default router
