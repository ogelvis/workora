import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { HttpError, logActivity, route } from '../lib.js'

// Profile pictures. They live under /api/auth so the owner console can show them too.
const router = express.Router()
router.use(requireAuth)

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const avatarBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_AVATAR_BYTES })

// Only real pictures: JPEG, PNG or WebP, recognised by their first bytes.
function pictureType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return null
}

export const avatarUrl = (userId, updatedAt) => (updatedAt ? `/api/auth/avatar/${userId}?v=${new Date(updatedAt).getTime()}` : null)

router.put('/avatar', avatarBody, route(async (request, response) => {
  if (!Buffer.isBuffer(request.body) || !request.body.length) throw new HttpError(400, 'Choose a picture (JPEG, PNG or WebP, up to 2 MB).')
  const type = pictureType(request.body)
  if (!type) throw new HttpError(400, 'That file isn’t a picture we can use. Choose a JPEG, PNG or WebP image.')
  const result = await pool.query(
    `INSERT INTO user_avatars (user_id, data, mime_type, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, mime_type = EXCLUDED.mime_type, updated_at = now()
     RETURNING updated_at`,
    [request.auth.userId, request.body, type],
  )
  if (request.auth.organizationId) await logActivity(pool, request.auth, 'updated their profile picture', 'user', request.auth.fullName)
  return response.json({ avatarUrl: avatarUrl(request.auth.userId, result.rows[0].updated_at) })
}))

router.delete('/avatar', route(async (request, response) => {
  await pool.query('DELETE FROM user_avatars WHERE user_id = $1', [request.auth.userId])
  return response.json({ avatarUrl: null })
}))

// Anyone who shares a workspace with the person (and the platform owner) can see their picture.
router.get('/avatar/:userId', route(async (request, response) => {
  const userId = z.uuid().parse(request.params.userId)
  const allowed = userId === request.auth.userId || request.auth.platformAdmin || (await pool.query(
    `SELECT 1 FROM organization_members a JOIN organization_members b ON b.organization_id = a.organization_id
     WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1`,
    [request.auth.userId, userId],
  )).rowCount > 0
  if (!allowed) throw new HttpError(404, 'Picture not found.')
  const result = await pool.query('SELECT data, mime_type FROM user_avatars WHERE user_id = $1', [userId])
  if (!result.rowCount) throw new HttpError(404, 'Picture not found.')
  // The URL changes whenever the picture does, so browsers can keep it for a long time.
  response.set('Cache-Control', 'private, max-age=31536000, immutable')
  response.set('Content-Type', result.rows[0].mime_type)
  response.set('X-Content-Type-Options', 'nosniff')
  return response.send(result.rows[0].data)
}))

export default router
