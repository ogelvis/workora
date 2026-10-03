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

export default router
