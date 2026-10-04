import bcrypt from 'bcryptjs'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { pool } from '../db.js'
import { createSession, destroySession, hashToken, requireAuth } from '../auth.js'
import {
  HttpError, emailSchema, getSubscription, logActivity, notify, passwordSchema, route,
  validationError, withTransaction,
} from '../lib.js'

const router = express.Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
})

const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  businessEmail: emailSchema,
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
})

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  fullName: z.string().trim().min(2).max(120),
  password: passwordSchema,
})

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
})

function accountPayload({ userId, fullName, email, organizationId, organizationName, role }) {
  return {
    user: { id: userId, fullName, email },
    organization: { id: organizationId, name: organizationName },
    role,
  }
}

router.post('/register', authLimiter, route(async (request, response) => {
  const parsed = registerSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)

  const values = parsed.data
  const email = values.email.toLowerCase()
  const passwordHash = await bcrypt.hash(values.password, 12)
  const account = await withTransaction(async (client) => {
    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email])
    if (existingUser.rowCount) throw new HttpError(409, 'An account with this email already exists.')
    const organization = await client.query(
      'INSERT INTO organizations (name, business_email) VALUES ($1, $2) RETURNING id, name',
      [values.organizationName, values.businessEmail.toLowerCase()],
    )
    const user = await client.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, email',
      [values.fullName, email, passwordHash],
    )
    const organizationId = organization.rows[0].id
    const userId = user.rows[0].id
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [organizationId, userId],
    )
    await client.query(
      `INSERT INTO subscriptions (organization_id, plan_id, status)
       SELECT $1, id, 'trial' FROM subscription_plans WHERE name = 'Starter'`,
      [organizationId],
    )
    await client.query(
      `INSERT INTO chat_channels (organization_id, name, description, created_by)
       VALUES ($1, 'general', 'Company-wide conversation', $2)`,
      [organizationId, userId],
    )
    const auth = { organizationId, userId }
    await logActivity(client, auth, 'created workspace', 'organization', organization.rows[0].name)
    return {
      userId, fullName: user.rows[0].full_name, email: user.rows[0].email,
      organizationId, organizationName: organization.rows[0].name, role: 'owner',
    }
  })
  await createSession(account.userId, response)
  return response.status(201).json(accountPayload(account))
}))

router.post('/login', authLimiter, route(async (request, response) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.password_hash, om.organization_id,
            o.name AS organization_name, om.role
     FROM users u
     JOIN organization_members om ON om.user_id = u.id
     JOIN organizations o ON o.id = om.organization_id
     WHERE u.email = $1
     ORDER BY om.created_at ASC
     LIMIT 1`,
    [parsed.data.email.toLowerCase()],
  )
  const row = result.rows[0]
  if (!row || !(await bcrypt.compare(parsed.data.password, row.password_hash))) {
    return response.status(401).json({ error: 'Email or password is incorrect.' })
  }
  await createSession(row.id, response)
  const account = {
    userId: row.id, fullName: row.full_name, email: row.email,
    organizationId: row.organization_id, organizationName: row.organization_name, role: row.role,
  }
  await logActivity(pool, account, 'signed in', 'user', row.full_name)
  return response.json(accountPayload(account))
}))

router.post('/logout', route(async (request, response) => {
  await destroySession(request, response)
  return response.status(204).end()
}))

router.get('/me', requireAuth, route(async (request, response) => {
  const subscription = await getSubscription(pool, request.auth.organizationId)
  return response.json({
    ...accountPayload(request.auth),
    platformAdmin: request.auth.platformAdmin,
    subscription: subscription && {
      plan: subscription.plan_name,
      status: subscription.status,
      trialEndsAt: subscription.trial_ends_at,
      trialExpired: subscription.trialExpired,
      currentPeriodEnd: subscription.current_period_end,
    },
  })
}))

router.post('/change-password', requireAuth, authLimiter, route(async (request, response) => {
  const parsed = changePasswordSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const user = await pool.query('SELECT password_hash FROM users WHERE id = $1', [request.auth.userId])
  if (!(await bcrypt.compare(parsed.data.currentPassword, user.rows[0].password_hash))) {
    return response.status(400).json({ error: 'Your current password is incorrect.' })
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)
  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, request.auth.userId])
    await client.query('DELETE FROM user_sessions WHERE user_id = $1 AND id != $2', [request.auth.userId, request.auth.sessionId])
    await logActivity(client, request.auth, 'changed their password', 'user', request.auth.fullName)
  })
  return response.json({ ok: true })
}))

router.get('/sessions', requireAuth, route(async (request, response) => {
  const result = await pool.query(
    `SELECT id, created_at AS "createdAt", expires_at AS "expiresAt"
     FROM user_sessions WHERE user_id = $1 AND expires_at > now()
     ORDER BY created_at DESC`,
    [request.auth.userId],
  )
  return response.json({
    sessions: result.rows.map((session) => ({ ...session, current: session.id === request.auth.sessionId })),
  })
}))

router.post('/sessions/revoke-others', requireAuth, route(async (request, response) => {
  const result = await pool.query(
    'DELETE FROM user_sessions WHERE user_id = $1 AND id != $2',
    [request.auth.userId, request.auth.sessionId],
  )
  return response.json({ revoked: result.rowCount })
}))

async function findInvitation(db, token) {
  const result = await db.query(
    `SELECT i.id, i.email, i.role, i.organization_id, i.invited_by, o.name AS organization_name
     FROM invitations i
     JOIN organizations o ON o.id = i.organization_id
     WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)],
  )
  return result.rows[0]
}

router.get('/invitations/:token', authLimiter, route(async (request, response) => {
  const invitation = await findInvitation(pool, request.params.token)
  if (!invitation) return response.status(404).json({ error: 'This invitation link is invalid or has expired.' })
  return response.json({
    email: invitation.email,
    role: invitation.role,
    organizationName: invitation.organization_name,
  })
}))

router.post('/accept-invite', authLimiter, route(async (request, response) => {
  const parsed = acceptInviteSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const values = parsed.data
  const passwordHash = await bcrypt.hash(values.password, 12)
  const account = await withTransaction(async (client) => {
    const invitation = await findInvitation(client, values.token)
    if (!invitation) throw new HttpError(404, 'This invitation link is invalid or has expired.')
    await client.query('SELECT 1 FROM subscriptions WHERE organization_id = $1 FOR UPDATE', [invitation.organization_id])
    const limits = await client.query(
      `SELECT sp.user_limit, (SELECT count(*)::int FROM organization_members WHERE organization_id = $1) AS members
       FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id WHERE s.organization_id = $1`,
      [invitation.organization_id],
    )
    if (limits.rows[0] && limits.rows[0].members >= limits.rows[0].user_limit) {
      throw new HttpError(409, 'This workspace has reached its member limit. Ask the owner to upgrade the plan.')
    }

    const existing = await client.query(
      `SELECT u.id, EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id) AS has_workspace
       FROM users u WHERE u.email = $1`,
      [invitation.email],
    )
    let userId
    if (existing.rowCount && existing.rows[0].has_workspace) {
      throw new HttpError(409, 'This email already belongs to a Workora workspace. Sign in instead.')
    } else if (existing.rowCount) {
      userId = existing.rows[0].id
      await client.query('UPDATE users SET full_name = $1, password_hash = $2 WHERE id = $3', [values.fullName, passwordHash, userId])
    } else {
      const user = await client.query(
        'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [values.fullName, invitation.email, passwordHash],
      )
      userId = user.rows[0].id
    }
    await client.query(
      'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)',
      [invitation.organization_id, userId, invitation.role],
    )
    await client.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [invitation.id])
    const auth = { organizationId: invitation.organization_id, userId }
    await logActivity(client, auth, 'joined the workspace as', invitation.role, values.fullName)
    if (invitation.invited_by) {
      const inviter = await client.query(
        'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2',
        [invitation.organization_id, invitation.invited_by],
      )
      if (inviter.rowCount) {
        await notify(client, invitation.organization_id, invitation.invited_by, {
          title: `${values.fullName} joined your workspace`,
          message: `They accepted your invitation as ${invitation.role}.`,
        })
      }
    }
    return {
      userId, fullName: values.fullName, email: invitation.email,
      organizationId: invitation.organization_id, organizationName: invitation.organization_name, role: invitation.role,
    }
  })
  await createSession(account.userId, response)
  return response.status(201).json(accountPayload(account))
}))

async function findReset(db, token) {
  const result = await db.query(
    `SELECT pr.id, pr.user_id, u.email
     FROM password_resets pr JOIN users u ON u.id = pr.user_id
     WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()`,
    [hashToken(token)],
  )
  return result.rows[0]
}

router.get('/password-resets/:token', authLimiter, route(async (request, response) => {
  const reset = await findReset(pool, request.params.token)
  if (!reset) return response.status(404).json({ error: 'This reset link is invalid or has expired.' })
  return response.json({ email: reset.email })
}))

router.post('/reset-password', authLimiter, route(async (request, response) => {
  const parsed = resetSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const passwordHash = await bcrypt.hash(parsed.data.password, 12)
  await withTransaction(async (client) => {
    const reset = await findReset(client, parsed.data.token)
    if (!reset) throw new HttpError(404, 'This reset link is invalid or has expired.')
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, reset.user_id])
    await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id])
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [reset.user_id])
  })
  return response.json({ ok: true })
}))

export default router
