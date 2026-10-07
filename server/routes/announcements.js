import express from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { route } from '../lib.js'

// OVO's own announcements (product, policy, security, service), as each person's role sees them.
const router = express.Router()
router.use(requireAuth)

const AUDIENCES = { owner: ['everyone', 'admins', 'owners'], admin: ['everyone', 'admins'], manager: ['everyone'], staff: ['everyone'] }

router.get('/announcements', route(async (request, response) => {
  const result = await pool.query(
    `SELECT id, category, title, body, cta_label AS "ctaLabel", cta_url AS "ctaUrl", sent_at AS "sentAt",
            audience IN ('people', 'workspace') AS personal
     FROM announcements
     WHERE audience = ANY($1)
        OR (audience = 'people' AND $2::uuid = ANY(recipient_ids))
        OR (audience = 'workspace' AND organization_id = $3)
     ORDER BY sent_at DESC LIMIT 50`,
    [AUDIENCES[request.auth.role] || ['everyone'], request.auth.userId, request.auth.organizationId],
  )
  return response.json({ announcements: result.rows })
}))

export default router
