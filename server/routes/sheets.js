import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { HttpError, logActivity, route, withTransaction } from '../lib.js'
import { COLUMN_TYPES, OPTION_COLORS, SHEET_TEMPLATES, industryFor } from '../../shared/industries.js'
import { allows, clean, columnId, permissionFor } from '../sheet-values.js'
import { runAutomations } from '../automation.js'

const router = express.Router()
router.use(requireAuth)

const MAX_SHEETS = 200
const MAX_ROWS = 10000
const MAX_IMPORT_ROWS = 5000
const TYPES = COLUMN_TYPES.map((column) => column.type)
const COLORS = [...OPTION_COLORS, 'indigo']

const optionSchema = z.object({ label: z.string().trim().min(1).max(60), color: z.enum(COLORS).catch('slate') })
const columnSchema = z.object({
  id: z.string().regex(/^c_[a-z0-9]{4,20}$/).optional(),
  name: z.string().trim().min(1).max(60),
  type: z.enum(TYPES),
  options: z.array(optionSchema).max(60).optional(),
  width: z.number().int().min(60).max(800).optional(),
})
const viewSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(40),
  search: z.string().max(200).optional(),
  sort: z.object({ column: z.string().max(40), direction: z.enum(['asc', 'desc']) }).nullable().optional(),
  groupBy: z.string().max(40).nullable().optional(),
  filters: z.array(z.object({ column: z.string().max(40), operator: z.string().max(20), value: z.string().max(200).optional() })).max(10).optional(),
  hidden: z.array(z.string().max(40)).max(60).optional(),
})
const sheetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  icon: z.string().trim().max(30).optional(),
  color: z.enum(COLORS).optional(),
  pinned: z.boolean().optional(),
  columns: z.array(columnSchema).max(60).optional(),
  views: z.array(viewSchema).max(20).optional(),
  templateKey: z.string().max(40).optional(),
  access: z.object({
    default: z.enum(['none', 'view', 'comment', 'edit']),
    members: z.record(z.uuid(), z.enum(['none', 'view', 'comment', 'edit', 'full'])),
  }).optional(),
})
const cellValue = z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()])
const rowSchema = z.object({ data: z.record(z.string().max(40), cellValue) })

function withIds(columns) {
  return columns.map((column) => ({ ...column, id: column.id || columnId() }))
}

const sheetColumns = `s.id, s.name, s.description, s.icon, s.color, s.columns, s.views, s.template_key AS "templateKey",
  s.pinned, s.position, s.access, s.created_by AS "createdById", s.created_at AS "createdAt", s.updated_at AS "updatedAt"`
// A record as the app shows it, re-read after automations may have changed it.
async function freshRow(id) {
  const result = await pool.query(
    `SELECT id, data, position, created_at AS "createdAt", updated_at AS "updatedAt", created_by AS "createdById", updated_by AS "updatedById"
     FROM sheet_rows WHERE id = $1`,
    [id],
  )
  return result.rows[0]
}

const rowColumns = `r.id, r.data, r.position, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
  r.created_by AS "createdById", r.updated_by AS "updatedById"`

const NEEDED_MESSAGE = {
  view: 'You don’t have access to this sheet.',
  comment: 'You can view this sheet but not comment on it.',
  edit: 'You can view this sheet but not change its records.',
  full: 'Only people with full access can change this sheet’s structure or settings.',
}

// Loads a sheet the caller may use at the `need` level. A sheet someone can't see at all
// answers 404, so its existence isn't revealed.
export async function loadSheet(db, id, auth, { lock = false, need = 'view' } = {}) {
  const result = await db.query(
    `SELECT ${sheetColumns} FROM sheets s WHERE s.id = $1 AND s.organization_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [id, auth.organizationId],
  )
  const sheet = result.rows[0]
  if (!sheet) throw new HttpError(404, 'Sheet not found.')
  const permission = permissionFor(auth, sheet)
  if (permission === 'none') throw new HttpError(404, 'Sheet not found.')
  if (!allows(permission, need)) throw new HttpError(403, NEEDED_MESSAGE[need])
  return { ...sheet, permission }
}

// Creates the sheets an industry starts with. Used on sign-up and from the template gallery.
export async function createSheetFromTemplate(db, { organizationId, userId, templateKey, pinned = false, position = 0 }) {
  const template = SHEET_TEMPLATES[templateKey]
  if (!template) throw new HttpError(400, 'Unknown template.')
  const result = await db.query(
    `INSERT INTO sheets (organization_id, name, description, icon, color, columns, template_key, pinned, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [organizationId, template.name, template.description, template.icon, template.color,
      JSON.stringify(withIds(template.columns)), templateKey, pinned, position, userId],
  )
  return result.rows[0].id
}

export async function seedIndustry(db, { organizationId, userId, industry }) {
  const { modules } = industryFor(industry)
  for (const [index, templateKey] of modules.entries()) {
    await createSheetFromTemplate(db, { organizationId, userId, templateKey, pinned: true, position: index })
  }
}

// ---------------------------------------------------------------- Sheets

router.get('/sheets', route(async (request, response) => {
  const result = await pool.query(
    `SELECT ${sheetColumns},
            (SELECT count(*)::int FROM sheet_rows r WHERE r.sheet_id = s.id) AS "rowCount",
            (SELECT max(r.updated_at) FROM sheet_rows r WHERE r.sheet_id = s.id) AS "lastEditedAt"
     FROM sheets s WHERE s.organization_id = $1
     ORDER BY s.pinned DESC, s.position, s.created_at`,
    [request.auth.organizationId],
  )
  const visible = result.rows
    .map((sheet) => ({ ...sheet, permission: permissionFor(request.auth, sheet) }))
    .filter((sheet) => sheet.permission !== 'none')
  return response.json({ sheets: visible.map(({ columns, views: _views, access: _access, ...sheet }) => ({ ...sheet, columnCount: columns.length })) })
}))

router.post('/sheets', route(async (request, response) => {
  const values = sheetSchema.parse(request.body)
  const { organizationId, userId } = request.auth
  const id = await withTransaction(async (client) => {
    const count = await client.query('SELECT count(*)::int AS count FROM sheets WHERE organization_id = $1', [organizationId])
    if (count.rows[0].count >= MAX_SHEETS) throw new HttpError(400, `A workspace can have up to ${MAX_SHEETS} sheets.`)
    const position = count.rows[0].count
    let sheetId
    if (values.templateKey) {
      sheetId = await createSheetFromTemplate(client, { organizationId, userId, templateKey: values.templateKey, pinned: values.pinned, position })
      if (values.name) await client.query('UPDATE sheets SET name = $1 WHERE id = $2', [values.name, sheetId])
    } else {
      const columns = withIds(values.columns?.length ? values.columns : [{ name: 'Name', type: 'text' }, { name: 'Status', type: 'select', options: [
        { label: 'To do', color: 'slate' }, { label: 'In progress', color: 'blue' }, { label: 'Done', color: 'green' },
      ] }, { name: 'Owner', type: 'person' }, { name: 'Date', type: 'date' }, { name: 'Notes', type: 'longtext' }])
      const result = await client.query(
        `INSERT INTO sheets (organization_id, name, description, icon, color, columns, pinned, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [organizationId, values.name, values.description || '', values.icon || 'sheet', values.color || 'violet',
          JSON.stringify(columns), Boolean(values.pinned), position, userId],
      )
      sheetId = result.rows[0].id
    }
    await logActivity(client, request.auth, 'created sheet', 'sheet', values.name)
    return sheetId
  })
  return response.status(201).json({ sheet: await loadSheet(pool, id, request.auth) })
}))

router.get('/sheets/:id', route(async (request, response) => {
  const sheet = await loadSheet(pool, request.params.id, request.auth)
  const rows = await pool.query(
    `SELECT ${rowColumns} FROM sheet_rows r WHERE r.sheet_id = $1 ORDER BY r.position, r.created_at LIMIT ${MAX_ROWS}`,
    [sheet.id],
  )
  return response.json({ sheet: { ...sheet, canDesign: sheet.permission === 'full' }, rows: rows.rows })
}))

router.put('/sheets/:id', route(async (request, response) => {
  const values = sheetSchema.partial().parse(request.body)
  await withTransaction(async (client) => {
    // Saving views needs edit access; columns, details, access and the shared sidebar need full access.
    const structural = ['name', 'description', 'icon', 'color', 'columns', 'pinned', 'access'].some((key) => key in values)
    const sheet = await loadSheet(client, request.params.id, request.auth, { lock: true, need: structural ? 'full' : 'edit' })
    const columns = values.columns ? withIds(values.columns) : sheet.columns
    if (new Set(columns.map((column) => column.id)).size !== columns.length) throw new HttpError(400, 'Column ids must be unique.')
    await client.query(
      `UPDATE sheets SET name = $1, description = $2, icon = $3, color = $4, columns = $5, views = $6, pinned = $7, access = $8, updated_at = now()
       WHERE id = $9`,
      [values.name ?? sheet.name, values.description ?? sheet.description, values.icon ?? sheet.icon, values.color ?? sheet.color,
        JSON.stringify(columns), JSON.stringify(values.views ?? sheet.views), values.pinned ?? sheet.pinned,
        JSON.stringify(values.access ?? sheet.access), sheet.id],
    )
    // A column whose type changed keeps only values that still make sense.
    const changed = columns.filter((column) => {
      const before = sheet.columns.find((old) => old.id === column.id)
      return before && before.type !== column.type
    })
    if (changed.length) {
      const rows = await client.query('SELECT id, data FROM sheet_rows WHERE sheet_id = $1', [sheet.id])
      for (const row of rows.rows) {
        const converted = clean(row.data, changed)
        await client.query('UPDATE sheet_rows SET data = data || $1 WHERE id = $2', [JSON.stringify(converted), row.id])
      }
    }
    // Values of removed columns go with them.
    const removed = sheet.columns.filter((old) => !columns.some((column) => column.id === old.id)).map((column) => column.id)
    if (removed.length) {
      await client.query('UPDATE sheet_rows SET data = data - $1::text[] WHERE sheet_id = $2', [removed, sheet.id])
    }
  })
  return response.json({ sheet: await loadSheet(pool, request.params.id, request.auth) })
}))

router.post('/sheets/:id/duplicate', route(async (request, response) => {
  const { withRows } = z.object({ withRows: z.boolean().optional() }).parse(request.body || {})
  const { organizationId, userId } = request.auth
  const id = await withTransaction(async (client) => {
    const sheet = await loadSheet(client, request.params.id, request.auth)
    const count = await client.query('SELECT count(*)::int AS count FROM sheets WHERE organization_id = $1', [organizationId])
    if (count.rows[0].count >= MAX_SHEETS) throw new HttpError(400, `A workspace can have up to ${MAX_SHEETS} sheets.`)
    const copy = await client.query(
      `INSERT INTO sheets (organization_id, name, description, icon, color, columns, views, template_key, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [organizationId, `${sheet.name} (copy)`.slice(0, 80), sheet.description, sheet.icon, sheet.color,
        JSON.stringify(sheet.columns), JSON.stringify(sheet.views), sheet.templateKey, count.rows[0].count, userId],
    )
    if (withRows) {
      await client.query(
        `INSERT INTO sheet_rows (sheet_id, organization_id, data, position, created_by, updated_by)
         SELECT $1, organization_id, data, position, $2, $2 FROM sheet_rows WHERE sheet_id = $3`,
        [copy.rows[0].id, userId, sheet.id],
      )
    }
    await logActivity(client, request.auth, 'duplicated sheet', 'sheet', sheet.name)
    return copy.rows[0].id
  })
  return response.status(201).json({ sheet: await loadSheet(pool, id, request.auth) })
}))

router.delete('/sheets/:id', route(async (request, response) => {
  const sheet = await loadSheet(pool, request.params.id, request.auth, { need: 'full' })
  await pool.query('DELETE FROM sheets WHERE id = $1', [sheet.id])
  await logActivity(pool, request.auth, 'deleted sheet', 'sheet', sheet.name)
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Records

// Most recently edited records across every sheet, for the home dashboard.
router.get('/records/recent', route(async (request, response) => {
  const result = await pool.query(
    `SELECT r.id, r.sheet_id AS "sheetId", r.data, r.updated_at AS "updatedAt", s.name AS "sheetName", s.icon, s.color, s.columns,
            s.access, s.created_by AS "createdById",
            u.full_name AS "updatedBy"
     FROM sheet_rows r JOIN sheets s ON s.id = r.sheet_id LEFT JOIN users u ON u.id = r.updated_by
     WHERE r.organization_id = $1 ORDER BY r.updated_at DESC LIMIT 40`,
    [request.auth.organizationId],
  )
  return response.json({
    // Records from sheets someone can't open stay out of their home page.
    records: result.rows
      .filter((row) => permissionFor(request.auth, row) !== 'none')
      .slice(0, 8)
      .map(({ columns, data, access: _access, createdById: _creator, ...row }) => ({ ...row, title: String((columns[0] && data[columns[0].id]) ?? '') })),
  })
}))

function describeChange(before, after, columns) {
  const names = columns.filter((column) => JSON.stringify(before[column.id] ?? null) !== JSON.stringify(after[column.id] ?? null))
  if (!names.length) return ''
  const first = names[0]
  const value = after[first.id]
  const shown = value === null || value === undefined ? 'empty' : first.type === 'checkbox' ? (value ? 'checked' : 'unchecked') : first.type === 'person' ? '' : String(value).slice(0, 60)
  const lead = shown ? `${first.name} → ${shown}` : `${first.name}`
  return names.length > 1 ? `${lead} and ${names.length - 1} more` : lead
}

router.post('/sheets/:id/rows', route(async (request, response) => {
  const { data } = rowSchema.parse(request.body)
  const { organizationId, userId } = request.auth
  const { row, sheet } = await withTransaction(async (client) => {
    const sheet = await loadSheet(client, request.params.id, request.auth, { lock: true, need: 'edit' })
    const stats = await client.query('SELECT count(*)::int AS count, COALESCE(max(position), 0) AS last FROM sheet_rows WHERE sheet_id = $1', [sheet.id])
    if (stats.rows[0].count >= MAX_ROWS) throw new HttpError(400, `A sheet can hold up to ${MAX_ROWS.toLocaleString()} records.`)
    const result = await client.query(
      `INSERT INTO sheet_rows (sheet_id, organization_id, data, position, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING id, data, position, created_at AS "createdAt", updated_at AS "updatedAt",
         created_by AS "createdById", updated_by AS "updatedById"`,
      [sheet.id, organizationId, JSON.stringify(clean(data, sheet.columns)), Number(stats.rows[0].last) + 1, userId],
    )
    await client.query(
      `INSERT INTO sheet_row_events (row_id, organization_id, user_id, kind, body) VALUES ($1, $2, $3, 'created', $4)`,
      [result.rows[0].id, organizationId, userId, `Added to ${sheet.name}`],
    )
    await client.query('UPDATE sheets SET updated_at = now() WHERE id = $1', [sheet.id])
    return { row: result.rows[0], sheet }
  })
  await runAutomations({ organizationId, actorId: userId, type: 'record_created', sheet, row })
  return response.status(201).json({ row: await freshRow(row.id) })
}))

router.patch('/sheets/:id/rows/:rowId', route(async (request, response) => {
  const { data } = rowSchema.parse(request.body)
  const { organizationId, userId } = request.auth
  const { row, sheet, changed } = await withTransaction(async (client) => {
    const sheet = await loadSheet(client, request.params.id, request.auth, { need: 'edit' })
    const current = await client.query('SELECT data FROM sheet_rows WHERE id = $1 AND sheet_id = $2 FOR UPDATE', [request.params.rowId, sheet.id])
    if (!current.rowCount) throw new HttpError(404, 'Record not found.')
    const changes = clean(data, sheet.columns)
    const next = { ...current.rows[0].data, ...changes }
    const result = await client.query(
      `UPDATE sheet_rows SET data = $1, updated_by = $2, updated_at = now() WHERE id = $3
       RETURNING id, data, position, created_at AS "createdAt", updated_at AS "updatedAt", created_by AS "createdById", updated_by AS "updatedById"`,
      [JSON.stringify(next), userId, request.params.rowId],
    )
    const summary = describeChange(current.rows[0].data, next, sheet.columns)
    if (summary) {
      await client.query(
        `INSERT INTO sheet_row_events (row_id, organization_id, user_id, kind, body) VALUES ($1, $2, $3, 'updated', $4)`,
        [request.params.rowId, organizationId, userId, summary],
      )
    }
    const changed = Object.fromEntries(Object.keys(changes)
      .filter((key) => JSON.stringify(current.rows[0].data[key] ?? null) !== JSON.stringify(changes[key] ?? null))
      .map((key) => [key, changes[key]]))
    return { row: result.rows[0], sheet, changed }
  })
  if (Object.keys(changed).length) {
    await runAutomations({ organizationId, actorId: userId, type: 'record_updated', sheet, row, changes: changed })
    return response.json({ row: await freshRow(row.id) })
  }
  return response.json({ row })
}))

router.post('/sheets/:id/rows/delete', route(async (request, response) => {
  const { ids } = z.object({ ids: z.array(z.uuid()).min(1).max(MAX_ROWS) }).parse(request.body)
  const sheet = await loadSheet(pool, request.params.id, request.auth, { need: 'edit' })
  const result = await pool.query('DELETE FROM sheet_rows WHERE sheet_id = $1 AND id = ANY($2::uuid[])', [sheet.id, ids])
  if (result.rowCount) await logActivity(pool, request.auth, `deleted ${result.rowCount} record${result.rowCount === 1 ? '' : 's'} from`, 'sheet', sheet.name)
  return response.json({ deleted: result.rowCount })
}))

// Bulk add from a CSV or Excel file the browser has already read.
router.post('/sheets/:id/import', route(async (request, response) => {
  const { headers, rows, addColumns } = z.object({
    headers: z.array(z.string().trim().max(60)).min(1).max(60),
    rows: z.array(z.array(cellValue).max(60)).max(MAX_IMPORT_ROWS),
    addColumns: z.boolean().optional(),
  }).parse(request.body)
  const { organizationId, userId } = request.auth
  const imported = await withTransaction(async (client) => {
    const sheet = await loadSheet(client, request.params.id, request.auth, { lock: true, need: 'edit' })
    const columns = [...sheet.columns]
    const mapping = headers.map((header) => {
      if (!header) return null
      const match = columns.find((column) => column.name.toLowerCase() === header.toLowerCase())
      if (match) return match.id
      if (!addColumns || columns.length >= 60) return null
      if (sheet.permission !== 'full') return null
      const column = { id: columnId(), name: header, type: 'text' }
      columns.push(column)
      return column.id
    })
    if (!mapping.some(Boolean)) throw new HttpError(400, 'None of the file’s column headings match this sheet. Turn on “Add missing columns” or rename the headings.')
    if (columns.length !== sheet.columns.length) {
      await client.query('UPDATE sheets SET columns = $1, updated_at = now() WHERE id = $2', [JSON.stringify(columns), sheet.id])
    }
    const stats = await client.query('SELECT count(*)::int AS count, COALESCE(max(position), 0) AS last FROM sheet_rows WHERE sheet_id = $1', [sheet.id])
    if (stats.rows[0].count + rows.length > MAX_ROWS) throw new HttpError(400, `A sheet can hold up to ${MAX_ROWS.toLocaleString()} records.`)
    let position = Number(stats.rows[0].last)
    const records = rows
      .map((cells) => {
        const data = {}
        mapping.forEach((id, index) => { if (id) data[id] = cells[index] ?? null })
        return clean(data, columns)
      })
      .filter((data) => Object.values(data).some((value) => value !== null && value !== false))
    // Insert in chunks to stay well inside PostgreSQL's parameter limit.
    for (let start = 0; start < records.length; start += 500) {
      const chunk = records.slice(start, start + 500)
      const params = []
      const tuples = chunk.map((data) => {
        position += 1
        params.push(JSON.stringify(data), position)
        return `($1, $2, $${params.length + 2}, $${params.length + 3}, $3, $3)`
      })
      await client.query(
        `INSERT INTO sheet_rows (sheet_id, organization_id, data, position, created_by, updated_by) VALUES ${tuples.join(', ')}`,
        [sheet.id, organizationId, userId, ...params],
      )
    }
    await logActivity(client, request.auth, `imported ${records.length} record${records.length === 1 ? '' : 's'} into`, 'sheet', sheet.name)
    return records.length
  })
  return response.json({ imported })
}))

router.get('/sheets/:id/rows/:rowId/timeline', route(async (request, response) => {
  const sheet = await loadSheet(pool, request.params.id, request.auth)
  const exists = await pool.query('SELECT 1 FROM sheet_rows WHERE id = $1 AND sheet_id = $2', [request.params.rowId, sheet.id])
  if (!exists.rowCount) throw new HttpError(404, 'Record not found.')
  const events = await pool.query(
    `SELECT e.id, e.kind, e.body, e.created_at AS "createdAt", e.user_id AS "userId", u.full_name AS "userName"
     FROM sheet_row_events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.row_id = $1 ORDER BY e.created_at DESC LIMIT 200`,
    [request.params.rowId],
  )
  return response.json({ events: events.rows })
}))

router.post('/sheets/:id/rows/:rowId/comments', route(async (request, response) => {
  const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(request.body)
  const sheet = await loadSheet(pool, request.params.id, request.auth, { need: 'comment' })
  const exists = await pool.query('SELECT 1 FROM sheet_rows WHERE id = $1 AND sheet_id = $2', [request.params.rowId, sheet.id])
  if (!exists.rowCount) throw new HttpError(404, 'Record not found.')
  const result = await pool.query(
    `INSERT INTO sheet_row_events (row_id, organization_id, user_id, kind, body) VALUES ($1, $2, $3, 'comment', $4)
     RETURNING id, kind, body, created_at AS "createdAt", user_id AS "userId"`,
    [request.params.rowId, request.auth.organizationId, request.auth.userId, body],
  )
  return response.status(201).json({ event: { ...result.rows[0], userName: request.auth.fullName } })
}))

export default router
