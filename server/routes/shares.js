import { randomBytes } from 'node:crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { pool } from '../db.js'
import { downloadUrl } from '../storage.js'
import { requireAuth } from '../auth.js'
import { ADMINS, HttpError, MANAGERS, logActivity, notify, route } from '../lib.js'
import { allows, permissionFor, readable } from '../sheet-values.js'
import { loadSheet } from './sheets.js'

// OVO Sharing: secure view-only links for sheets, records and files, and sending
// something to a teammate. Inside the workspace, sheet access levels decide who can do what.
export const publicShareRouter = express.Router()
const router = express.Router()
router.use(requireAuth)

const TYPES = ['sheet', 'record', 'file']

// What the caller may do with the thing being shared.
async function resolve(auth, type, id) {
  if (type === 'sheet') {
    const sheet = await loadSheet(pool, id, auth)
    return { name: sheet.name, sheetId: sheet.id, canShare: sheet.permission === 'full', link: `#/sheet?id=${sheet.id}`, sheet }
  }
  if (type === 'record') {
    const row = await pool.query('SELECT id, sheet_id, data FROM sheet_rows WHERE id = $1 AND organization_id = $2', [id, auth.organizationId])
    if (!row.rowCount) throw new HttpError(404, 'Record not found.')
    const sheet = await loadSheet(pool, row.rows[0].sheet_id, auth)
    const first = sheet.columns[0]
    const title = first ? String(row.rows[0].data[first.id] ?? '') : ''
    return { name: title || `a record in ${sheet.name}`, sheetId: sheet.id, canShare: allows(sheet.permission, 'edit'), link: `#/sheet?id=${sheet.id}&record=${id}`, sheet }
  }
  const file = await pool.query('SELECT id, name, vault, uploaded_by FROM files WHERE id = $1 AND organization_id = $2', [id, auth.organizationId])
  if (!file.rowCount) throw new HttpError(404, 'File not found.')
  if (file.rows[0].vault && !ADMINS.includes(auth.role)) throw new HttpError(404, 'File not found.')
  return {
    name: file.rows[0].name,
    canShare: MANAGERS.includes(auth.role) || file.rows[0].uploaded_by === auth.userId,
    link: file.rows[0].vault ? '#/vault' : '#/files',
    vault: file.rows[0].vault,
  }
}

const linkColumns = `l.id, l.resource_type AS "resourceType", l.resource_id AS "resourceId", l.token, l.view_id AS "viewId",
  l.allow_download AS "allowDownload", l.expires_at AS "expiresAt", l.revoked_at AS "revokedAt", l.view_count AS "viewCount",
  l.last_viewed_at AS "lastViewedAt", l.created_at AS "createdAt", u.full_name AS "createdBy"`

router.get('/shares', route(async (request, response) => {
  const query = z.object({ type: z.enum(TYPES), id: z.uuid() }).parse(request.query)
  const target = await resolve(request.auth, query.type, query.id)
  const result = await pool.query(
    `SELECT ${linkColumns} FROM share_links l LEFT JOIN users u ON u.id = l.created_by
     WHERE l.organization_id = $1 AND l.resource_type = $2 AND l.resource_id = $3 AND l.revoked_at IS NULL
     ORDER BY l.created_at DESC`,
    [request.auth.organizationId, query.type, query.id],
  )
  return response.json({ links: result.rows, canShare: target.canShare })
}))

router.post('/shares', route(async (request, response) => {
  const values = z.object({
    resourceType: z.enum(TYPES),
    resourceId: z.uuid(),
    viewId: z.string().max(40).nullable().optional(),
    allowDownload: z.boolean().optional(),
    expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  }).parse(request.body)
  const target = await resolve(request.auth, values.resourceType, values.resourceId)
  if (!target.canShare) throw new HttpError(403, 'You need full access to share this outside the workspace.')
  if (target.vault) throw new HttpError(400, 'Document Vault files can’t be shared by link.')
  if (values.viewId && !(target.sheet?.views || []).some((view) => view.id === values.viewId)) throw new HttpError(400, 'That view no longer exists.')
  const token = randomBytes(18).toString('base64url')
  const expiresAt = values.expiresInDays ? new Date(Date.now() + values.expiresInDays * 86_400_000) : null
  const result = await pool.query(
    `INSERT INTO share_links (organization_id, resource_type, resource_id, token, view_id, allow_download, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [request.auth.organizationId, values.resourceType, values.resourceId, token, values.viewId || null, Boolean(values.allowDownload), expiresAt, request.auth.userId],
  )
  await logActivity(pool, request.auth, `created a share link for`, values.resourceType, target.name)
  const link = await pool.query(`SELECT ${linkColumns} FROM share_links l LEFT JOIN users u ON u.id = l.created_by WHERE l.id = $1`, [result.rows[0].id])
  return response.status(201).json({ link: link.rows[0] })
}))

router.delete('/shares/:id', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const link = await pool.query('SELECT resource_type, resource_id, created_by FROM share_links WHERE id = $1 AND organization_id = $2', [request.params.id, request.auth.organizationId])
  if (!link.rowCount) throw new HttpError(404, 'Link not found.')
  const target = await resolve(request.auth, link.rows[0].resource_type, link.rows[0].resource_id)
  if (!target.canShare && link.rows[0].created_by !== request.auth.userId) throw new HttpError(403, 'Only people who can share this can turn its links off.')
  await pool.query('UPDATE share_links SET revoked_at = now() WHERE id = $1', [request.params.id])
  return response.status(204).end()
}))

// "Send to a teammate": a notification that opens the thing directly.
router.post('/shares/send', route(async (request, response) => {
  const values = z.object({
    resourceType: z.enum(TYPES),
    resourceId: z.uuid(),
    userIds: z.array(z.uuid()).min(1).max(50),
    message: z.string().trim().max(500).optional(),
  }).parse(request.body)
  const target = await resolve(request.auth, values.resourceType, values.resourceId)
  const members = await pool.query(
    'SELECT om.user_id, om.role FROM organization_members om WHERE om.organization_id = $1 AND om.user_id = ANY($2::uuid[])',
    [request.auth.organizationId, values.userIds],
  )
  let sent = 0
  const skipped = []
  for (const member of members.rows) {
    if (member.user_id === request.auth.userId) continue
    // Only send what the recipient can actually open.
    const auth = { userId: member.user_id, role: member.role, organizationId: request.auth.organizationId }
    const canOpen = target.sheet ? permissionFor(auth, target.sheet) !== 'none' : !target.vault || ADMINS.includes(member.role)
    if (!canOpen) { skipped.push(member.user_id); continue }
    await notify(pool, request.auth.organizationId, member.user_id, {
      title: `${request.auth.fullName} shared ${values.resourceType === 'file' ? 'a file' : values.resourceType === 'record' ? 'a record' : 'a sheet'} with you`,
      message: `${target.name}${values.message ? ` — “${values.message}”` : ''}`.slice(0, 1000),
      resourceType: values.resourceType,
      resourceId: values.resourceId,
      link: target.link,
    })
    sent += 1
  }
  return response.json({ sent, skipped: skipped.length })
}))

// ---------------------------------------------------------------- Public share pages

const viewLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } })

async function activeLink(token) {
  const result = await pool.query(
    `SELECT l.*, o.name AS organization_name FROM share_links l
     JOIN organizations o ON o.id = l.organization_id
     LEFT JOIN subscriptions sub ON sub.organization_id = l.organization_id
     WHERE l.token = $1 AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now())
       AND COALESCE(sub.status, 'trial') != 'suspended'`,
    [token],
  )
  return result.rows[0]
}

// The same filter rules the app uses, so a shared view shows exactly what it shows inside OVO.
function passes(filter, column, value, members) {
  const empty = value === null || value === undefined || value === ''
  const shown = readable(column, value, members).toLowerCase()
  const target = String(filter.value ?? '').trim().toLowerCase()
  switch (filter.operator) {
    case 'empty': return empty
    case 'filled': return !empty
    case 'checked': return value === true
    case 'unchecked': return value !== true
    case 'contains': return shown.includes(target)
    case 'is': return column.type === 'person' || column.type === 'date' ? value === filter.value : shown === target
    case 'not': return column.type === 'person' ? value !== filter.value : shown !== target
    case 'eq': return !empty && Number(value) === Number(filter.value)
    case 'gt': return !empty && Number(value) > Number(filter.value)
    case 'lt': return !empty && Number(value) < Number(filter.value)
    case 'before': return !empty && String(value) < filter.value
    case 'after': return !empty && String(value) > filter.value
    default: return true
  }
}

async function namesFor(organizationId) {
  const result = await pool.query(
    'SELECT u.id, u.full_name FROM organization_members om JOIN users u ON u.id = om.user_id WHERE om.organization_id = $1',
    [organizationId],
  )
  return new Map(result.rows.map((row) => [row.id, row.full_name]))
}

// Person columns become names; nothing internal (ids, who edited) leaves the workspace.
function publicRow(columns, data, members) {
  return Object.fromEntries(columns.map((column) => [column.id, column.type === 'person' ? (members.get(data[column.id]) || null) : data[column.id] ?? null]))
}

function publicColumns(columns) {
  return columns.map((column) => ({ id: column.id, name: column.name, type: column.type === 'person' ? 'text' : column.type, options: column.options }))
}

publicShareRouter.get('/public/share/:token', viewLimiter, route(async (request, response) => {
  const link = await activeLink(request.params.token)
  if (!link) return response.status(404).json({ error: 'This link doesn’t exist, has expired or was turned off.' })
  await pool.query('UPDATE share_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = $1', [link.id])
  const base = { type: link.resource_type, organizationName: link.organization_name, allowDownload: link.allow_download, expiresAt: link.expires_at }

  if (link.resource_type === 'file') {
    const file = await pool.query('SELECT name, mime_type, size_bytes::float AS size, created_at FROM files WHERE id = $1 AND organization_id = $2 AND NOT vault', [link.resource_id, link.organization_id])
    if (!file.rowCount) return response.status(404).json({ error: 'This file has been removed.' })
    return response.json({ ...base, allowDownload: true, file: { name: file.rows[0].name, mimeType: file.rows[0].mime_type, size: file.rows[0].size, createdAt: file.rows[0].created_at } })
  }

  const members = await namesFor(link.organization_id)
  if (link.resource_type === 'record') {
    const row = await pool.query(
      `SELECT r.data, r.updated_at, s.name, s.icon, s.color, s.columns FROM sheet_rows r JOIN sheets s ON s.id = r.sheet_id
       WHERE r.id = $1 AND r.organization_id = $2`,
      [link.resource_id, link.organization_id],
    )
    if (!row.rowCount) return response.status(404).json({ error: 'This record has been removed.' })
    const { columns, data, name, icon, color, updated_at: updatedAt } = row.rows[0]
    return response.json({ ...base, sheet: { name, icon, color, columns: publicColumns(columns) }, record: { data: publicRow(columns, data, members), updatedAt } })
  }

  const sheet = await pool.query('SELECT name, description, icon, color, columns, views FROM sheets WHERE id = $1 AND organization_id = $2', [link.resource_id, link.organization_id])
  if (!sheet.rowCount) return response.status(404).json({ error: 'This sheet has been removed.' })
  const { columns, views, ...details } = sheet.rows[0]
  const view = link.view_id ? views.find((item) => item.id === link.view_id) : null
  const visible = columns.filter((column) => !(view?.hidden || []).includes(column.id))
  const rows = await pool.query('SELECT data FROM sheet_rows WHERE sheet_id = $1 ORDER BY position, created_at LIMIT 5000', [link.resource_id])
  let records = rows.rows.map((row) => row.data)
  if (view) {
    const byId = Object.fromEntries(columns.map((column) => [column.id, column]))
    const needle = (view.search || '').trim().toLowerCase()
    records = records.filter((data) => (!needle || columns.some((column) => readable(column, data[column.id], members).toLowerCase().includes(needle)))
      && (view.filters || []).every((filter) => !byId[filter.column] || passes(filter, byId[filter.column], data[filter.column], members)))
    const sortColumn = view.sort && byId[view.sort.column]
    if (sortColumn) {
      const direction = view.sort.direction === 'desc' ? -1 : 1
      records.sort((a, b) => {
        const left = a[sortColumn.id]
        const right = b[sortColumn.id]
        if (left === right) return 0
        if (left === null || left === undefined) return 1
        if (right === null || right === undefined) return -1
        return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true })) * direction
      })
    }
  }
  return response.json({
    ...base,
    sheet: { ...details, viewName: view?.name || null, columns: publicColumns(visible) },
    rows: records.map((data) => publicRow(visible, data, members)),
  })
}))

publicShareRouter.get('/public/share/:token/download', viewLimiter, route(async (request, response) => {
  const link = await activeLink(request.params.token)
  if (!link || link.resource_type !== 'file') return response.status(404).json({ error: 'This link doesn’t exist, has expired or was turned off.' })
  const file = await pool.query('SELECT name, data, storage_key FROM files WHERE id = $1 AND organization_id = $2 AND NOT vault', [link.resource_id, link.organization_id])
  if (file.rows[0]?.storage_key) return response.redirect(302, await downloadUrl(file.rows[0].storage_key, file.rows[0].name))
  if (!file.rowCount) return response.status(404).json({ error: 'This file has been removed.' })
  response.set({
    'Content-Type': 'application/octet-stream',
    'Content-Length': file.rows[0].data.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.rows[0].name)}`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
  return response.send(file.rows[0].data)
}))

export default router
