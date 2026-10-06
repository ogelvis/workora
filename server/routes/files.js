import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { ADMINS, HttpError, MANAGERS, getSubscription, logActivity, route, withTransaction } from '../lib.js'
import { formatStorage } from '../format.js'

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

// Built-in folders plus any the business added itself (and any older folder that still holds files).
async function folderNames(db, organizationId, vault) {
  const custom = await db.query(
    'SELECT name FROM file_folders WHERE organization_id = $1 AND vault = $2 ORDER BY created_at',
    [organizationId, vault],
  )
  const names = [...(vault ? VAULT_FOLDERS : FOLDERS), ...custom.rows.map((row) => row.name)]
  return { names, custom: new Set(custom.rows.map((row) => row.name)) }
}

// Storage counts both shared files and documents sent in chat.
export async function storageUsed(db, organizationId) {
  const result = await db.query(
    `SELECT (SELECT COALESCE(sum(size_bytes), 0) FROM files WHERE organization_id = $1)
          + (SELECT COALESCE(sum(size_bytes), 0) FROM chat_attachments WHERE organization_id = $1) AS used`,
    [organizationId],
  )
  return Number(result.rows[0].used)
}

// Checks a new upload against the plan's storage; call inside a transaction holding the subscription lock.
export async function assertStorage(client, organizationId, size) {
  const subscription = await getSubscription(client, organizationId, { lock: true })
  const usedBytes = await storageUsed(client, organizationId)
  const limit = subscription ? Number(subscription.storage_limit_bytes) : 0
  if (usedBytes >= limit) {
    throw new HttpError(413, `Your storage is full: ${formatStorage(usedBytes)} of ${formatStorage(limit)} used. Delete files or upgrade your plan to upload more.`)
  }
  if (usedBytes + size > limit) {
    throw new HttpError(413, `Not enough space for this file. ${formatStorage(limit - usedBytes)} is left on your plan and the file is ${formatStorage(size)}.`)
  }
}

// Reads the name and type a client sends with a raw upload.
export function uploadedName(request) {
  let name
  try {
    name = decodeURIComponent(request.get('x-file-name') || '').trim()
  } catch {
    name = ''
  }
  // eslint-disable-next-line no-control-regex -- strip path separators and control characters
  return name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255)
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
  const known = await folderNames(pool, request.auth.organizationId, vault)
  const names = [...known.names, ...folders.rows.map((row) => row.folder).filter((name) => !known.names.includes(name))]
  const [usedBytes, subscription] = await Promise.all([
    storageUsed(pool, request.auth.organizationId),
    getSubscription(pool, request.auth.organizationId),
  ])
  return response.json({
    storage: { usedBytes, limitBytes: subscription ? Number(subscription.storage_limit_bytes) : 0 },
    files: result.rows,
    folders: names.map((name) => ({
      name,
      count: folders.rows.find((row) => row.folder === name)?.count || 0,
      custom: known.custom.has(name),
    })),
    canManageFolders: vault ? canUseVault(request.auth.role) : MANAGERS.includes(request.auth.role),
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
    const { names: folders } = await folderNames(pool, request.auth.organizationId, vault)
    const folder = folders.includes(request.query.folder) ? request.query.folder : (vault ? VAULT_FOLDERS : FOLDERS).at(-1)
    const name = uploadedName(request)
    const mimeType = (request.get('x-file-type') || 'application/octet-stream').slice(0, 120)
    if (!name) return response.status(400).json({ error: 'Choose a file with a name.' })
    if (!Buffer.isBuffer(request.body) || !request.body.length) {
      return response.status(400).json({ error: 'The uploaded file is empty.' })
    }
    const size = request.body.length

    const file = await withTransaction(async (client) => {
      // The subscription row lock inside assertStorage serialises uploads so they cannot overshoot.
      await assertStorage(client, request.auth.organizationId, size)
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

// ---------------------------------------------------------------- Folders
const folderSchema = z.object({
  name: z.string().trim().min(1, 'Name the folder.').max(60).regex(/^[^/\\<>]+$/, 'Folder names can’t contain / \\ < or >.'),
  vault: z.boolean().optional().default(false),
})

function canManageFolders(role, vault) {
  return vault ? canUseVault(role) : MANAGERS.includes(role)
}

router.post('/files/folders', route(async (request, response) => {
  const values = folderSchema.parse(request.body)
  scope(request, values.vault)
  if (!canManageFolders(request.auth.role, values.vault)) throw new HttpError(403, 'Only owners, admins and managers can add folders.')
  const { names } = await folderNames(pool, request.auth.organizationId, values.vault)
  if (names.some((name) => name.toLowerCase() === values.name.toLowerCase())) throw new HttpError(409, 'A folder with that name already exists.')
  const count = await pool.query('SELECT count(*)::int AS count FROM file_folders WHERE organization_id = $1', [request.auth.organizationId])
  if (count.rows[0].count >= 100) throw new HttpError(400, 'A workspace can have up to 100 extra folders.')
  await pool.query(
    'INSERT INTO file_folders (organization_id, vault, name, created_by) VALUES ($1, $2, $3, $4)',
    [request.auth.organizationId, values.vault, values.name, request.auth.userId],
  )
  await logActivity(pool, request.auth, values.vault ? 'added a vault folder' : 'added a folder', 'folder', values.name)
  return response.status(201).json({ folder: { name: values.name, count: 0, custom: true } })
}))

// Only folders the business added can be deleted, and only once they're empty.
router.delete('/files/folders', route(async (request, response) => {
  const values = folderSchema.parse({ name: request.query.name, vault: request.query.vault === '1' })
  scope(request, values.vault)
  if (!canManageFolders(request.auth.role, values.vault)) throw new HttpError(403, 'Only owners, admins and managers can delete folders.')
  const used = await pool.query(
    'SELECT count(*)::int AS count FROM files WHERE organization_id = $1 AND vault = $2 AND folder = $3',
    [request.auth.organizationId, values.vault, values.name],
  )
  if (used.rows[0].count) throw new HttpError(409, `Move or delete the ${used.rows[0].count} ${used.rows[0].count === 1 ? 'file' : 'files'} in “${values.name}” first.`)
  const result = await pool.query(
    'DELETE FROM file_folders WHERE organization_id = $1 AND vault = $2 AND name = $3 RETURNING name',
    [request.auth.organizationId, values.vault, values.name],
  )
  if (!result.rowCount) throw new HttpError(404, 'Only folders you added can be deleted.')
  await logActivity(pool, request.auth, 'deleted a folder', 'folder', values.name)
  return response.status(204).end()
}))

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
