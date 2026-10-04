import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { MANAGERS, HttpError, logActivity, route, validationError } from '../lib.js'

const router = express.Router()
router.use(requireAuth)

const channelSchema = z.object({
  name: z.string().trim().toLowerCase()
    .transform((value) => value.replace(/^#/, '').replace(/\s+/g, '-'))
    .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Channel names use lowercase letters, numbers and dashes.')),
  description: z.string().trim().max(200).optional(),
})

const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) })

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
       SELECT m.id, m.body, m.created_at AS "createdAt", m.user_id AS "userId", u.full_name AS "userName"
       FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
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
       SELECT m.id, m.body, m.created_at AS "createdAt", m.sender_id AS "userId", u.full_name AS "userName"
       FROM direct_messages m LEFT JOIN users u ON u.id = m.sender_id
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

export default router
