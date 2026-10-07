import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { ADMINS, HttpError, assertVideoAllowed, getSubscription, logActivity, route, withTransaction } from '../lib.js'
import { FOLDERS, VAULT_FOLDERS, assertStorage, folderNames, storageUsed } from './files.js'
import { addChannelAttachment, addDirectAttachment, assertChannel, findConversation } from './chat.js'
import { R2_MAX_FILE_BYTES, deleteObjects, getObjectStart, newStorageKey, objectSize, r2Configured, readTicket, signTicket, uploadUrl } from '../storage.js'
import { formatStorage } from '../format.js'

// Large files go straight from the browser to Cloudflare R2:
// 1. POST /uploads asks for a signed upload link (after checking permission and space),
// 2. the browser PUTs the file to R2,
// 3. POST /uploads/complete checks the file arrived and records it.
const router = express.Router()
router.use(requireAuth)

const startSchema = z.object({
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(R2_MAX_FILE_BYTES, `Files can be up to ${R2_MAX_FILE_BYTES / 1024 / 1024} MB.`),
  type: z.string().max(120).optional().default('application/octet-stream'),
  target: z.enum(['files', 'channel', 'dm']),
  folder: z.string().max(80).optional(),
  vault: z.boolean().optional().default(false),
  targetId: z.uuid().optional(),
})

async function checkTarget(request, values) {
  if (values.target === 'files') {
    if (values.vault && !ADMINS.includes(request.auth.role)) throw new HttpError(403, 'Only workspace owners and admins can add to the Document Vault.')
    const { names } = await folderNames(pool, request.auth.organizationId, values.vault)
    return { folder: names.includes(values.folder) ? values.folder : (values.vault ? VAULT_FOLDERS : FOLDERS).at(-1) }
  }
  if (!values.targetId) throw new HttpError(400, 'Choose a conversation.')
  if (values.target === 'channel') await assertChannel(request.auth.organizationId, values.targetId)
  else await findConversation({ ...request, params: { id: values.targetId } })
  return {}
}

router.post('/uploads', route(async (request, response) => {
  if (!r2Configured()) return response.json({ direct: false })
  const values = startSchema.parse(request.body)
  const extra = await checkTarget(request, values)
  await assertVideoAllowed(pool, request.auth.organizationId, { name: values.name, mimeType: values.type })
  const [subscription, used] = await Promise.all([getSubscription(pool, request.auth.organizationId), storageUsed(pool, request.auth.organizationId)])
  const limit = subscription ? Number(subscription.storage_limit_bytes) : 0
  if (used + values.size > limit) {
    throw new HttpError(413, used >= limit
      ? `Your storage is full: ${formatStorage(used)} of ${formatStorage(limit)} used. Delete files or upgrade your plan to upload more.`
      : `Not enough space for this file. ${formatStorage(limit - used)} is left on your plan and the file is ${formatStorage(values.size)}.`)
  }
  const key = newStorageKey(request.auth.organizationId, values.name)
  const ticket = signTicket({ o: request.auth.organizationId, u: request.auth.userId, key, ...values, ...extra })
  return response.json({ direct: true, uploadUrl: await uploadUrl(key), ticket })
}))

router.post('/uploads/complete', route(async (request, response) => {
  const { ticket: raw, caption } = z.object({ ticket: z.string().max(4000), caption: z.string().trim().max(4000).optional().default('') }).parse(request.body)
  const ticket = readTicket(raw)
  if (!ticket || ticket.o !== request.auth.organizationId || ticket.u !== request.auth.userId) throw new HttpError(400, 'This upload has expired. Please try again.')
  const size = await objectSize(ticket.key)
  if (size === null) throw new HttpError(400, 'The file didn’t finish uploading. Please try again.')
  if (size !== ticket.size) {
    await deleteObjects([ticket.key])
    throw new HttpError(400, 'The uploaded file doesn’t match. Please try again.')
  }
  // Each upload is recorded once; completing it again would point two records at one object.
  const recorded = await pool.query('SELECT 1 FROM files WHERE storage_key = $1 UNION ALL SELECT 1 FROM chat_attachments WHERE storage_key = $1', [ticket.key])
  if (recorded.rowCount) throw new HttpError(409, 'This file has already been saved.')
  // The browser named it; the content decides. A renamed video is refused and removed.
  try {
    await assertVideoAllowed(pool, request.auth.organizationId, { name: ticket.name, mimeType: ticket.type, head: await getObjectStart(ticket.key) })
  } catch (error) {
    if (error.code === 'upgrade') await deleteObjects([ticket.key])
    throw error
  }
  const upload = { name: ticket.name, mimeType: ticket.type, size, storageKey: ticket.key, caption }
  const result = await withTransaction(async (client) => {
    await assertStorage(client, request.auth.organizationId, size)
    if (ticket.target === 'channel') return { message: await addChannelAttachment(client, request.auth, ticket.targetId, upload) }
    if (ticket.target === 'dm') {
      const conversation = await findConversation({ ...request, params: { id: ticket.targetId } })
      return { message: await addDirectAttachment(client, request.auth, conversation, upload) }
    }
    const inserted = await client.query(
      `INSERT INTO files (organization_id, folder, vault, name, mime_type, size_bytes, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [request.auth.organizationId, ticket.folder, ticket.vault, ticket.name, ticket.type, size, ticket.key, request.auth.userId],
    )
    await logActivity(client, request.auth, ticket.vault ? 'added to the vault' : 'uploaded', 'file', ticket.name)
    const file = await client.query(
      `SELECT f.id, f.name, f.folder, f.vault, f.mime_type AS "mimeType", f.size_bytes::float AS "sizeBytes",
              f.created_at AS "createdAt", f.uploaded_by AS "uploadedById", u.full_name AS "uploadedBy"
       FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.id = $1`,
      [inserted.rows[0].id],
    )
    return { file: file.rows[0] }
  }).catch(async (error) => {
    // Nothing points at the object, so don't leave it taking up space
    // (unless a simultaneous request already recorded it: 23505 from the unique index).
    if (error.code !== '23505') await deleteObjects([ticket.key])
    throw error
  })
  return response.status(201).json(result)
}))

export default router
