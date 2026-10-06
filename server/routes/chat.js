import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { MANAGERS, HttpError, logActivity, route, validationError, withTransaction } from '../lib.js'
import { MAX_FILE_BYTES, assertStorage, uploadedName } from './files.js'

const router = express.Router()
router.use(requireAuth)

const channelSchema = z.object({
  name: z.string().trim().toLowerCase()
    .transform((value) => value.replace(/^#/, '').replace(/\s+/g, '-'))
    .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Channel names use lowercase letters, numbers and dashes.')),
  description: z.string().trim().max(200).optional(),
})

const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) })

// A message can carry one shared document.
const attachmentJson = `CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object(
  'id', a.id, 'name', a.name, 'mimeType', a.mime_type, 'sizeBytes', a.size_bytes::float) END AS attachment`
const attachmentColumns = `a.id, a.name, a.mime_type AS "mimeType", a.size_bytes::float AS "sizeBytes", a.created_at AS "createdAt", u.full_name AS "uploadedBy"`
const rawUpload = express.raw({ type: 'application/octet-stream', limit: MAX_FILE_BYTES })

function readUpload(request) {
  const name = uploadedName(request)
  if (!name) throw new HttpError(400, 'Choose a file with a name.')
  if (!Buffer.isBuffer(request.body) || !request.body.length) throw new HttpError(400, 'The file is empty.')
  let caption = ''
  try { caption = decodeURIComponent(request.get('x-caption') || '').trim().slice(0, 4000) } catch { caption = '' }
  return { name, caption, mimeType: (request.get('x-file-type') || 'application/octet-stream').slice(0, 120), data: request.body }
}

async function assertChannel(organizationId, channelId) {
  const result = await pool.query(
    'SELECT id, name FROM chat_channels WHERE id = $1 AND organization_id = $2',
    [channelId, organizationId],
  )
  if (!result.rowCount) throw new HttpError(404, 'Channel not found.')
  return result.rows[0]
}

router.get('/channels', route(async (request, response) => {
  const result = await pool.query(
    `SELECT c.id, c.name, c.description, c.created_at AS "createdAt",
            (SELECT max(m.created_at) FROM chat_messages m WHERE m.channel_id = c.id) AS "lastMessageAt"
     FROM chat_channels c WHERE c.organization_id = $1
     ORDER BY c.name = 'general' DESC, c.name`,
    [request.auth.organizationId],
  )
  return response.json({ channels: result.rows })
}))

router.post('/channels', requireRole(...MANAGERS), route(async (request, response) => {
  const parsed = channelSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const existing = await pool.query(
    'SELECT 1 FROM chat_channels WHERE organization_id = $1 AND name = $2',
    [request.auth.organizationId, parsed.data.name],
  )
  if (existing.rowCount) return response.status(409).json({ error: `#${parsed.data.name} already exists.` })
  const result = await pool.query(
    `INSERT INTO chat_channels (organization_id, name, description, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id, name, description, created_at AS "createdAt"`,
    [request.auth.organizationId, parsed.data.name, parsed.data.description || '', request.auth.userId],
  )
  await logActivity(pool, request.auth, 'created channel', 'channel', `#${parsed.data.name}`)
  return response.status(201).json({ channel: { ...result.rows[0], lastMessageAt: null } })
}))

router.delete('/channels/:id', requireRole(...MANAGERS), route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const channel = await assertChannel(request.auth.organizationId, request.params.id)
  if (channel.name === 'general') return response.status(400).json({ error: 'The #general channel cannot be deleted.' })
  await pool.query('DELETE FROM chat_channels WHERE id = $1', [channel.id])
  await logActivity(pool, request.auth, 'deleted channel', 'channel', `#${channel.name}`)
  return response.status(204).end()
}))

router.get('/channels/:id/messages', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  await assertChannel(request.auth.organizationId, request.params.id)
  const result = await pool.query(
    `SELECT * FROM (
       SELECT m.id, m.body, m.created_at AS "createdAt", m.user_id AS "userId", u.full_name AS "userName", ${attachmentJson}
       FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN chat_attachments a ON a.message_id = m.id AND a.channel_id = m.channel_id
       WHERE m.channel_id = $1
       ORDER BY m.created_at DESC LIMIT 200
     ) recent ORDER BY "createdAt" ASC`,
    [request.params.id],
  )
  return response.json({ messages: result.rows })
}))

router.post('/channels/:id/messages', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const parsed = messageSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  await assertChannel(request.auth.organizationId, request.params.id)
  const result = await pool.query(
    `INSERT INTO chat_messages (organization_id, channel_id, user_id, body)
     VALUES ($1, $2, $3, $4) RETURNING id, body, created_at AS "createdAt", user_id AS "userId"`,
    [request.auth.organizationId, request.params.id, request.auth.userId, parsed.data.body],
  )
  return response.status(201).json({ message: { ...result.rows[0], userName: request.auth.fullName } })
}))

router.post('/channels/:id/attachments', rawUpload, route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const upload = readUpload(request)
  await assertChannel(request.auth.organizationId, request.params.id)
  const message = await withTransaction(async (client) => {
    await assertStorage(client, request.auth.organizationId, upload.data.length)
    const inserted = await client.query(
      `INSERT INTO chat_messages (organization_id, channel_id, user_id, body)
       VALUES ($1, $2, $3, $4) RETURNING id, body, created_at AS "createdAt", user_id AS "userId"`,
      [request.auth.organizationId, request.params.id, request.auth.userId, upload.caption || `Shared ${upload.name}`],
    )
    const attachment = await client.query(
      `INSERT INTO chat_attachments (organization_id, channel_id, message_id, name, mime_type, size_bytes, data, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, mime_type AS "mimeType", size_bytes::float AS "sizeBytes"`,
      [request.auth.organizationId, request.params.id, inserted.rows[0].id, upload.name, upload.mimeType, upload.data.length, upload.data, request.auth.userId],
    )
    return { ...inserted.rows[0], userName: request.auth.fullName, attachment: attachment.rows[0] }
  })
  return response.status(201).json({ message })
}))

router.get('/channels/:id/attachments', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  await assertChannel(request.auth.organizationId, request.params.id)
  const result = await pool.query(
    `SELECT ${attachmentColumns} FROM chat_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.channel_id = $1 AND a.organization_id = $2 ORDER BY a.created_at`,
    [request.params.id, request.auth.organizationId],
  )
  return response.json({ attachments: result.rows })
}))

// ---------------------------------------------------------------- Direct messages
// Only the two participants can read a conversation; workspace owners and admins cannot.

function participantColumn(conversation, userId) {
  if (conversation.user_a === userId) return 'user_a_read_at'
  if (conversation.user_b === userId) return 'user_b_read_at'
  return null
}

async function findConversation(request) {
  z.uuid().parse(request.params.id)
  const result = await pool.query(
    'SELECT id, user_a, user_b FROM direct_conversations WHERE id = $1 AND organization_id = $2',
    [request.params.id, request.auth.organizationId],
  )
  const conversation = result.rows[0]
  // Report "not found" to non-participants so conversation ids reveal nothing.
  if (!conversation || !participantColumn(conversation, request.auth.userId)) throw new HttpError(404, 'Conversation not found.')
  return conversation
}

router.get('/dms', route(async (request, response) => {
  const { organizationId, userId } = request.auth
  const result = await pool.query(
    `SELECT dc.id, dc.last_message_at AS "lastMessageAt",
            other.id AS "userId", other.full_name AS "userName",
            EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = dc.organization_id AND om.user_id = other.id) AS "isMember",
            (SELECT body FROM direct_messages m WHERE m.conversation_id = dc.id ORDER BY created_at DESC LIMIT 1) AS "lastMessage",
            (SELECT count(*)::int FROM direct_messages m
             WHERE m.conversation_id = dc.id AND m.sender_id IS DISTINCT FROM $2
               AND m.created_at > CASE WHEN dc.user_a = $2 THEN dc.user_a_read_at ELSE dc.user_b_read_at END) AS unread
     FROM direct_conversations dc
     JOIN users other ON other.id = CASE WHEN dc.user_a = $2 THEN dc.user_b ELSE dc.user_a END
     WHERE dc.organization_id = $1 AND (dc.user_a = $2 OR dc.user_b = $2)
     ORDER BY dc.last_message_at DESC NULLS LAST, dc.created_at DESC`,
    [organizationId, userId],
  )
  return response.json({ conversations: result.rows })
}))

router.post('/dms', route(async (request, response) => {
  const parsed = z.object({ userId: z.uuid() }).safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const { organizationId, userId } = request.auth
  const otherId = parsed.data.userId
  if (otherId === userId) return response.status(400).json({ error: 'Choose a teammate to message.' })
  const member = await pool.query(
    'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [organizationId, otherId],
  )
  if (!member.rowCount) return response.status(404).json({ error: 'That person is not in this workspace.' })
  const [userA, userB] = [userId, otherId].sort()
  await pool.query(
    `INSERT INTO direct_conversations (organization_id, user_a, user_b) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, user_a, user_b) DO NOTHING`,
    [organizationId, userA, userB],
  )
  const result = await pool.query(
    'SELECT id FROM direct_conversations WHERE organization_id = $1 AND user_a = $2 AND user_b = $3',
    [organizationId, userA, userB],
  )
  return response.status(201).json({ conversation: { id: result.rows[0].id } })
}))

router.get('/dms/:id/messages', route(async (request, response) => {
  const conversation = await findConversation(request)
  const result = await pool.query(
    `SELECT * FROM (
       SELECT m.id, m.body, m.created_at AS "createdAt", m.sender_id AS "userId", u.full_name AS "userName", ${attachmentJson}
       FROM direct_messages m LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN chat_attachments a ON a.message_id = m.id AND a.conversation_id = m.conversation_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at DESC LIMIT 200
     ) recent ORDER BY "createdAt" ASC`,
    [conversation.id],
  )
  // Opening a conversation marks it read for this participant.
  await pool.query(
    `UPDATE direct_conversations SET ${participantColumn(conversation, request.auth.userId)} = now() WHERE id = $1`,
    [conversation.id],
  )
  return response.json({ messages: result.rows })
}))

router.post('/dms/:id/messages', route(async (request, response) => {
  const parsed = messageSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const conversation = await findConversation(request)
  const otherId = conversation.user_a === request.auth.userId ? conversation.user_b : conversation.user_a
  const member = await pool.query(
    'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [request.auth.organizationId, otherId],
  )
  if (!member.rowCount) return response.status(400).json({ error: 'This person is no longer in the workspace.' })
  const result = await pool.query(
    `INSERT INTO direct_messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)
     RETURNING id, body, created_at AS "createdAt", sender_id AS "userId"`,
    [conversation.id, request.auth.userId, parsed.data.body],
  )
  await pool.query(
    `UPDATE direct_conversations SET last_message_at = $2, ${participantColumn(conversation, request.auth.userId)} = $2 WHERE id = $1`,
    [conversation.id, result.rows[0].createdAt],
  )
  return response.status(201).json({ message: { ...result.rows[0], userName: request.auth.fullName } })
}))

router.post('/dms/:id/attachments', rawUpload, route(async (request, response) => {
  const upload = readUpload(request)
  const conversation = await findConversation(request)
  const message = await withTransaction(async (client) => {
    await assertStorage(client, request.auth.organizationId, upload.data.length)
    const inserted = await client.query(
      `INSERT INTO direct_messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)
       RETURNING id, body, created_at AS "createdAt", sender_id AS "userId"`,
      [conversation.id, request.auth.userId, upload.caption || `Shared ${upload.name}`],
    )
    const attachment = await client.query(
      `INSERT INTO chat_attachments (organization_id, conversation_id, message_id, name, mime_type, size_bytes, data, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, mime_type AS "mimeType", size_bytes::float AS "sizeBytes"`,
      [request.auth.organizationId, conversation.id, inserted.rows[0].id, upload.name, upload.mimeType, upload.data.length, upload.data, request.auth.userId],
    )
    await client.query(
      `UPDATE direct_conversations SET last_message_at = $2, ${participantColumn(conversation, request.auth.userId)} = $2 WHERE id = $1`,
      [conversation.id, inserted.rows[0].createdAt],
    )
    return { ...inserted.rows[0], userName: request.auth.fullName, attachment: attachment.rows[0] }
  })
  return response.status(201).json({ message })
}))

router.get('/dms/:id/attachments', route(async (request, response) => {
  const conversation = await findConversation(request)
  const result = await pool.query(
    `SELECT ${attachmentColumns} FROM chat_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.conversation_id = $1 ORDER BY a.created_at`,
    [conversation.id],
  )
  return response.json({ attachments: result.rows })
}))

// Channel documents are open to the whole workspace; direct-message documents only to the two people.
router.get('/chat/attachments/:id/download', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const result = await pool.query(
    `SELECT a.name, a.data, a.channel_id, c.user_a, c.user_b
     FROM chat_attachments a LEFT JOIN direct_conversations c ON c.id = a.conversation_id
     WHERE a.id = $1 AND a.organization_id = $2`,
    [request.params.id, request.auth.organizationId],
  )
  const file = result.rows[0]
  if (!file || (!file.channel_id && ![file.user_a, file.user_b].includes(request.auth.userId))) throw new HttpError(404, 'File not found.')
  response.set({
    'Content-Type': 'application/octet-stream',
    'Content-Length': file.data.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
  return response.send(file.data)
}))

export default router
