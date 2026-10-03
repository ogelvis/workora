import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { ADMINS, HttpError, getSubscription, logActivity, route, withTransaction } from '../lib.js'

const router = express.Router()
router.use(requireAuth)

// Files are stored in PostgreSQL. Vercel functions accept request bodies up to 4.5 MB.
export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const FOLDERS = ['Company Documents', 'Marketing', 'Clients', 'Projects', 'Finance', 'HR', 'Images', 'Videos', 'Shared Files']
export const VAULT_FOLDERS = ['Legal', 'Contracts', 'Policies', 'Certificates', 'HR Records', 'Financial Records']
// Raster images may open in the browser; everything else (including SVG, HTML and PDF) downloads.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const listSchema = z.object({
  vault: z.enum(['0', '1']).optional(),
  folder: z.string().max(80).optional(),
})

function canUseVault(role) {
  return ADMINS.includes(role)
}

function scope(request, vault) {
  if (vault && !canUseVault(request.auth.role)) {
    throw new HttpError(403, 'Only workspace owners and admins can open the Document Vault.')
  }
}

const fileColumns = `f.id, f.name, f.folder, f.vault, f.mime_type AS "mimeType", f.size_bytes::float AS "sizeBytes",
                     f.created_at AS "createdAt", f.uploaded_by AS "uploadedById", u.full_name AS "uploadedBy"`

router.get('/files', route(async (request, response) => {
  const query = listSchema.parse(request.query)
  const vault = query.vault === '1'
  scope(request, vault)
  const result = await pool.query(
    `SELECT ${fileColumns}
     FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
     WHERE f.organization_id = $1 AND f.vault = $2 AND ($3::text IS NULL OR f.folder = $3)
     ORDER BY f.created_at DESC LIMIT 500`,
    [request.auth.organizationId, vault, query.folder || null],
  )
  const folders = await pool.query(
    `SELECT folder, count(*)::int AS count FROM files
     WHERE organization_id = $1 AND vault = $2 GROUP BY folder`,
    [request.auth.organizationId, vault],
  )
  return response.json({
    files: result.rows,
    folders: (vault ? VAULT_FOLDERS : FOLDERS).map((name) => ({
      name,
      count: folders.rows.find((row) => row.folder === name)?.count || 0,
    })),
    maxFileBytes: MAX_FILE_BYTES,
  })
}))

// The client sends the raw file bytes with an octet-stream content type so the JSON
// parser never touches them; the original name and type travel in headers.
router.post(
  '/files',
  express.raw({ type: 'application/octet-stream', limit: MAX_FILE_BYTES }),
  route(async (request, response) => {
    const vault = request.query.vault === '1'
    scope(request, vault)
    const folders = vault ? VAULT_FOLDERS : FOLDERS
    const folder = folders.includes(request.query.folder) ? request.query.folder : folders[folders.length - 1]
    let name
    try {
      name = decodeURIComponent(request.get('x-file-name') || '').trim()
    } catch {
      name = ''
    }
    // eslint-disable-next-line no-control-regex -- strip path separators and control characters
    name = name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255)
    const mimeType = (request.get('x-file-type') || 'application/octet-stream').slice(0, 120)
    if (!name) return response.status(400).json({ error: 'Choose a file with a name.' })
    if (!Buffer.isBuffer(request.body) || !request.body.length) {
      return response.status(400).json({ error: 'The uploaded file is empty.' })
    }
    const size = request.body.length

    const file = await withTransaction(async (client) => {
      const subscription = await getSubscription(client, request.auth.organizationId, { lock: true })
      const used = await client.query(
        'SELECT COALESCE(sum(size_bytes), 0)::float AS used FROM files WHERE organization_id = $1',
        [request.auth.organizationId],
      )
      if (subscription && used.rows[0].used + size > Number(subscription.storage_limit_bytes)) {
        throw new HttpError(413, 'This upload would exceed your plan’s storage limit.')
      }
      const inserted = await client.query(
        `INSERT INTO files (organization_id, folder, vault, name, mime_type, size_bytes, data, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [request.auth.organizationId, folder, vault, name, mimeType, size, request.body, request.auth.userId],
      )
      await logActivity(client, request.auth, vault ? 'added to the vault' : 'uploaded', 'file', name)
      const result = await client.query(
        `SELECT ${fileColumns} FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.id = $1`,
        [inserted.rows[0].id],
      )
      return result.rows[0]
    })
    return response.status(201).json({ file })
  }),
)

async function findFile(request, withData) {
  const result = await pool.query(
    `SELECT id, name, vault, mime_type, uploaded_by ${withData ? ', data' : ''}
     FROM files WHERE id = $1 AND organization_id = $2`,
    [request.params.id, request.auth.organizationId],
  )
  const file = result.rows[0]
  if (!file) throw new HttpError(404, 'File not found in this workspace.')
  scope(request, file.vault)
  return file
}

router.get('/files/:id/download', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const file = await findFile(request, true)
  const inline = request.query.inline === '1' && INLINE_TYPES.has(file.mime_type)
  response.set({
    'Content-Type': inline ? file.mime_type : 'application/octet-stream',
    'Content-Length': file.data.length,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  })
  return response.send(file.data)
}))

router.delete('/files/:id', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const file = await findFile(request, false)
  const isAdmin = ADMINS.includes(request.auth.role)
  const isManager = request.auth.role === 'manager'
  if (!isAdmin && !isManager && file.uploaded_by !== request.auth.userId) {
    return response.status(403).json({ error: 'You can only delete files you uploaded.' })
  }
  await pool.query('DELETE FROM files WHERE id = $1', [file.id])
  await logActivity(pool, request.auth, file.vault ? 'removed from the vault' : 'deleted', 'file', file.name)
  return response.status(204).end()
}))

export default router
