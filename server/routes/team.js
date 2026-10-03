import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import {
  ADMINS, HttpError, appUrl, createToken, emailSchema, getSubscription, logActivity, route,
  validationError, withTransaction,
} from '../lib.js'

const router = express.Router()
router.use(requireAuth)
const adminsOnly = requireRole(...ADMINS)

const INVITE_DAYS = 7
const RESET_HOURS = 24

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'manager', 'staff']),
})

const roleSchema = z.object({ role: z.enum(['admin', 'manager', 'staff']) })

const profileSchema = z.object({
  name: z.string().trim().min(2).max(160),
  businessEmail: emailSchema,
  website: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  industry: z.string().trim().max(120).optional(),
})

// Owners manage everyone; admins manage managers and staff.
function canManage(actorRole, targetRole) {
  if (targetRole === 'owner') return false
  if (actorRole === 'owner') return true
  return actorRole === 'admin' && ['manager', 'staff'].includes(targetRole)
}

async function getMember(db, organizationId, userId) {
  const result = await db.query(
    `SELECT om.role, u.full_name, u.email FROM organization_members om
     JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = $1 AND om.user_id = $2`,
    [organizationId, userId],
  )
  if (!result.rowCount) throw new HttpError(404, 'Member not found in this workspace.')
  return result.rows[0]
}

// ---------------------------------------------------------------- Members

router.get('/members', route(async (request, response) => {
  const result = await pool.query(
    `SELECT u.id, u.full_name AS "fullName", u.email, om.role, om.created_at AS "joinedAt",
            (SELECT count(*)::int FROM tasks t
             WHERE t.organization_id = om.organization_id AND t.assignee_id = u.id AND t.status != 'Completed') AS "openTasks"
     FROM organization_members om
     JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = $1
     ORDER BY array_position(ARRAY['owner', 'admin', 'manager', 'staff'], om.role), u.full_name`,
    [request.auth.organizationId],
  )
  return response.json({ members: result.rows })
}))

router.patch('/members/:userId', adminsOnly, route(async (request, response) => {
  const parsed = roleSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const { role } = parsed.data
  const member = await getMember(pool, request.auth.organizationId, request.params.userId)
  if (request.params.userId === request.auth.userId) return response.status(400).json({ error: 'You cannot change your own role.' })
  if (!canManage(request.auth.role, member.role) || !canManage(request.auth.role, role)) {
    return response.status(403).json({ error: 'You do not have permission to assign that role.' })
  }
  await pool.query(
    'UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND user_id = $3',
    [role, request.auth.organizationId, request.params.userId],
  )
  await logActivity(pool, request.auth, `changed role to ${role} for`, 'member', member.full_name)
  return response.json({ member: { id: request.params.userId, role } })
}))

router.delete('/members/:userId', adminsOnly, route(async (request, response) => {
  if (request.params.userId === request.auth.userId) return response.status(400).json({ error: 'You cannot remove yourself.' })
  await withTransaction(async (client) => {
    const member = await getMember(client, request.auth.organizationId, request.params.userId)
    if (!canManage(request.auth.role, member.role)) throw new HttpError(403, 'You do not have permission to remove this member.')
    await client.query(
      'UPDATE tasks SET assignee_id = NULL WHERE organization_id = $1 AND assignee_id = $2',
      [request.auth.organizationId, request.params.userId],
    )
    await client.query(
      'DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2',
      [request.auth.organizationId, request.params.userId],
    )
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [request.params.userId])
    await logActivity(client, request.auth, 'removed member', 'member', member.full_name)
  })
  return response.status(204).end()
}))

router.post('/members/:userId/reset-link', adminsOnly, route(async (request, response) => {
  const member = await getMember(pool, request.auth.organizationId, request.params.userId)
  if (request.params.userId !== request.auth.userId && !canManage(request.auth.role, member.role)) {
    return response.status(403).json({ error: 'You do not have permission to reset this member’s password.' })
  }
  const { token, tokenHash } = createToken()
  const expiresAt = new Date(Date.now() + RESET_HOURS * 60 * 60 * 1000)
  await pool.query(
    'INSERT INTO password_resets (user_id, token_hash, created_by, expires_at) VALUES ($1, $2, $3, $4)',
    [request.params.userId, tokenHash, request.auth.userId, expiresAt],
  )
  await logActivity(pool, request.auth, 'created a password reset link for', 'member', member.full_name)
  return response.status(201).json({ link: appUrl(request, `/?reset=${token}`), expiresAt })
}))

// ---------------------------------------------------------------- Invitations

router.get('/invitations', adminsOnly, route(async (request, response) => {
  const result = await pool.query(
    `SELECT i.id, i.email, i.role, i.expires_at AS "expiresAt", i.created_at AS "createdAt", u.full_name AS "invitedBy"
     FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.organization_id = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
     ORDER BY i.created_at DESC`,
    [request.auth.organizationId],
  )
  return response.json({ invitations: result.rows })
}))

router.post('/invitations', adminsOnly, route(async (request, response) => {
  const parsed = inviteSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const email = parsed.data.email.toLowerCase()
  const { role } = parsed.data
  if (!canManage(request.auth.role, role)) return response.status(403).json({ error: 'Only the workspace owner can invite admins.' })

  const { token, tokenHash } = createToken()
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000)
  const invitation = await withTransaction(async (client) => {
    const subscription = await getSubscription(client, request.auth.organizationId, { lock: true })
    const counts = await client.query(
      `SELECT (SELECT count(*)::int FROM organization_members WHERE organization_id = $1) AS members,
              (SELECT count(*)::int FROM invitations WHERE organization_id = $1 AND accepted_at IS NULL AND expires_at > now() AND email != $2) AS pending`,
      [request.auth.organizationId, email],
    )
    const { members, pending } = counts.rows[0]
    if (subscription && members + pending >= subscription.user_limit) {
      throw new HttpError(409, `The ${subscription.plan_name} plan includes ${subscription.user_limit} members, including pending invitations.`)
    }
    const existing = await client.query(
      `SELECT 1 FROM users u JOIN organization_members om ON om.user_id = u.id WHERE u.email = $1`,
      [email],
    )
    if (existing.rowCount) throw new HttpError(409, 'This person already belongs to a Workora workspace.')
    // Re-inviting the same email replaces the earlier link.
    await client.query(
      'DELETE FROM invitations WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL',
      [request.auth.organizationId, email],
    )
    const result = await client.query(
      `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, role, expires_at AS "expiresAt", created_at AS "createdAt"`,
      [request.auth.organizationId, email, role, tokenHash, request.auth.userId, expiresAt],
    )
    await logActivity(client, request.auth, `invited a new ${role}`, 'invitation', email)
    return result.rows[0]
  })
  return response.status(201).json({
    invitation: { ...invitation, invitedBy: request.auth.fullName },
    link: appUrl(request, `/?invite=${token}`),
  })
}))

router.delete('/invitations/:id', adminsOnly, route(async (request, response) => {
  const result = await pool.query(
    'DELETE FROM invitations WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL RETURNING email',
    [request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Invitation not found.' })
  await logActivity(pool, request.auth, 'revoked the invitation for', 'invitation', result.rows[0].email)
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Company profile

const profileColumns = `id, name, business_email AS "businessEmail", website, phone, address, industry, created_at AS "createdAt"`

router.get('/organization', route(async (request, response) => {
  const result = await pool.query(`SELECT ${profileColumns} FROM organizations WHERE id = $1`, [request.auth.organizationId])
  return response.json({ organization: result.rows[0] })
}))

router.put('/organization', adminsOnly, route(async (request, response) => {
  const parsed = profileSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const values = parsed.data
  const result = await pool.query(
    `UPDATE organizations SET name = $1, business_email = $2, website = $3, phone = $4, address = $5, industry = $6
     WHERE id = $7 RETURNING ${profileColumns}`,
    [values.name, values.businessEmail.toLowerCase(), values.website || '', values.phone || '', values.address || '', values.industry || '', request.auth.organizationId],
  )
  await logActivity(pool, request.auth, 'updated the company profile', 'organization', values.name)
  return response.json({ organization: result.rows[0] })
}))

// ---------------------------------------------------------------- Billing

router.get('/billing', adminsOnly, route(async (request, response) => {
  const organizationId = request.auth.organizationId
  const [subscription, plans, usage] = await Promise.all([
    getSubscription(pool, organizationId),
    pool.query(
      `SELECT name, user_limit AS "userLimit", storage_limit_bytes::float AS "storageLimitBytes", project_limit AS "projectLimit"
       FROM subscription_plans WHERE active ORDER BY user_limit`,
    ),
    pool.query(
      `SELECT (SELECT count(*)::int FROM organization_members WHERE organization_id = $1) AS members,
              (SELECT count(*)::int FROM invitations WHERE organization_id = $1 AND accepted_at IS NULL AND expires_at > now()) AS "pendingInvites",
              (SELECT count(*)::int FROM projects WHERE organization_id = $1) AS projects,
              (SELECT COALESCE(sum(size_bytes), 0)::float FROM files WHERE organization_id = $1) AS "storageBytes"`,
      [organizationId],
    ),
  ])
  return response.json({
    subscription: subscription && {
      plan: subscription.plan_name,
      status: subscription.status,
      trialEndsAt: subscription.trial_ends_at,
      trialExpired: subscription.trialExpired,
      userLimit: subscription.user_limit,
      storageLimitBytes: Number(subscription.storage_limit_bytes),
      projectLimit: subscription.project_limit,
    },
    usage: usage.rows[0],
    plans: plans.rows,
    paymentsEnabled: false,
  })
}))

export default router
