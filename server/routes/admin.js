import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { HttpError, appUrl, createToken, route, validationError, withTransaction } from '../lib.js'

// Public plan catalogue for the landing page.
export const publicRouter = express.Router()

const planSelect = `
  SELECT name, user_limit AS "userLimit", storage_limit_bytes::float AS "storageLimitBytes",
         project_limit AS "projectLimit", monthly_price::float AS "monthlyPrice",
         yearly_price::float AS "yearlyPrice", currency, active, sort_order AS "sortOrder"
  FROM subscription_plans`

publicRouter.get('/plans', route(async (_request, response) => {
  const result = await pool.query(`${planSelect} WHERE active ORDER BY sort_order, user_limit`)
  response.set('Cache-Control', 'public, max-age=300')
  return response.json({ plans: result.rows })
}))

// Platform administration: only emails listed in PLATFORM_ADMIN_EMAILS get past this router.
const router = express.Router()
router.use(requireAuth, (request, response, next) => {
  if (!request.auth.platformAdmin) return response.status(404).json({ error: 'Not found.' })
  return next()
})

const STATUSES = ['trial', 'active', 'past_due', 'cancelled', 'expired', 'suspended']

const subscriptionSchema = z.object({
  plan: z.string().trim().min(1).max(60),
  status: z.enum(STATUSES),
  trialEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  currentPeriodEnd: z.iso.datetime({ offset: true }).nullable().optional(),
  billingNotes: z.string().trim().max(2000).optional(),
})

const planSchema = z.object({
  userLimit: z.coerce.number().int().min(1).max(2147483647),
  storageLimitGb: z.coerce.number().min(0.1).max(100000),
  projectLimit: z.coerce.number().int().min(1).max(1000000).nullable(),
  monthlyPrice: z.coerce.number().min(0).max(999999999).nullable(),
  yearlyPrice: z.coerce.number().min(0).max(999999999).nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code such as NGN or USD.'),
  active: z.boolean(),
})

function audit(db, auth, action, targetType, target, details = {}) {
  return db.query(
    `INSERT INTO admin_audit_log (admin_user_id, admin_email, action, target_type, target_id, target_name, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [auth.userId, auth.email, action, targetType, target.id || null, target.name || '', JSON.stringify(details)],
  )
}

const orgSelect = `
  SELECT o.id, o.name, o.business_email AS "businessEmail", o.industry, o.created_at AS "createdAt",
         sp.name AS plan, s.status, s.trial_ends_at AS "trialEndsAt", s.current_period_end AS "currentPeriodEnd",
         s.billing_notes AS "billingNotes", sp.monthly_price::float AS "monthlyPrice", sp.currency,
         owner.full_name AS "ownerName", owner.email AS "ownerEmail",
         (SELECT count(*)::int FROM organization_members m WHERE m.organization_id = o.id) AS members,
         (SELECT count(*)::int FROM projects p WHERE p.organization_id = o.id) AS projects,
         (SELECT COALESCE(sum(size_bytes), 0)::float FROM files f WHERE f.organization_id = o.id) AS "storageBytes",
         sp.storage_limit_bytes::float AS "storageLimitBytes", sp.user_limit AS "userLimit",
         (SELECT max(created_at) FROM activity_logs a WHERE a.organization_id = o.id) AS "lastActiveAt"
  FROM organizations o
  LEFT JOIN subscriptions s ON s.organization_id = o.id
  LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
  LEFT JOIN LATERAL (
    SELECT u.full_name, u.email FROM organization_members om JOIN users u ON u.id = om.user_id
    WHERE om.organization_id = o.id AND om.role = 'owner' ORDER BY om.created_at LIMIT 1
  ) owner ON true`

router.get('/overview', route(async (_request, response) => {
  const [totals, byPlan, signups, audits] = await Promise.all([
    pool.query(`
      SELECT (SELECT count(*)::int FROM organizations) AS workspaces,
             (SELECT count(*)::int FROM users) AS users,
             (SELECT count(*)::int FROM subscriptions WHERE status = 'trial' AND (trial_ends_at IS NULL OR trial_ends_at > now())) AS "activeTrials",
             (SELECT count(*)::int FROM subscriptions WHERE status = 'trial' AND trial_ends_at <= now()) AS "endedTrials",
             (SELECT count(*)::int FROM subscriptions WHERE status = 'active') AS paying,
             (SELECT count(*)::int FROM subscriptions WHERE status = 'suspended') AS suspended,
             (SELECT COALESCE(sum(sp.monthly_price), 0)::float FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id WHERE s.status = 'active') AS mrr,
             (SELECT min(currency) FROM subscription_plans) AS currency,
             (SELECT COALESCE(sum(size_bytes), 0)::float FROM files) AS "storageBytes",
             (SELECT count(*)::int FROM organizations WHERE created_at > now() - interval '30 days') AS "newLast30Days"`),
    pool.query(`
      SELECT sp.name AS plan, count(s.id)::int AS count
      FROM subscription_plans sp LEFT JOIN subscriptions s ON s.plan_id = sp.id
      GROUP BY sp.name, sp.sort_order ORDER BY sp.sort_order`),
    pool.query(`
      SELECT to_char(week, 'YYYY-MM-DD') AS week, count(o.id)::int AS count
      FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS week
      LEFT JOIN organizations o ON date_trunc('week', o.created_at) = week
      GROUP BY week ORDER BY week`),
    pool.query(`SELECT id, admin_email AS "adminEmail", action, target_type AS "targetType", target_name AS "targetName", created_at AS "createdAt"
                FROM admin_audit_log ORDER BY created_at DESC LIMIT 8`),
  ])
  return response.json({ totals: totals.rows[0], byPlan: byPlan.rows, weeklySignups: signups.rows, recentAudit: audits.rows })
}))

router.get('/organizations', route(async (request, response) => {
  const query = z.object({ q: z.string().max(200).optional(), status: z.enum(STATUSES).optional() }).parse(request.query)
  const result = await pool.query(
    `${orgSelect}
     WHERE ($1::text IS NULL OR o.name ILIKE '%' || $1 || '%' OR o.business_email ILIKE '%' || $1 || '%' OR owner.email ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR s.status = $2)
     ORDER BY o.created_at DESC LIMIT 500`,
    [query.q || null, query.status || null],
  )
  return response.json({ organizations: result.rows })
}))

router.get('/organizations/:id', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const organization = await pool.query(`${orgSelect} WHERE o.id = $1`, [request.params.id])
  if (!organization.rowCount) return response.status(404).json({ error: 'Workspace not found.' })
  const [members, activity] = await Promise.all([
    pool.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, om.role, om.created_at AS "joinedAt"
       FROM organization_members om JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1
       ORDER BY array_position(ARRAY['owner', 'admin', 'manager', 'staff'], om.role), u.full_name`,
      [request.params.id],
    ),
    pool.query(
      `SELECT al.id, al.action, al.object_name AS object, al.created_at AS "createdAt", u.full_name AS "userName"
       FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
       WHERE al.organization_id = $1 ORDER BY al.created_at DESC LIMIT 15`,
      [request.params.id],
    ),
  ])
  return response.json({ organization: organization.rows[0], members: members.rows, activity: activity.rows })
}))

router.put('/organizations/:id/subscription', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const parsed = subscriptionSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const values = parsed.data
  await withTransaction(async (client) => {
    const organization = await client.query('SELECT id, name FROM organizations WHERE id = $1', [request.params.id])
    if (!organization.rowCount) throw new HttpError(404, 'Workspace not found.')
    const plan = await client.query('SELECT id FROM subscription_plans WHERE name = $1', [values.plan])
    if (!plan.rowCount) throw new HttpError(400, 'That plan does not exist.')
    const before = await client.query(
      `SELECT sp.name AS plan, s.status, s.trial_ends_at, s.current_period_end
       FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id WHERE s.organization_id = $1`,
      [request.params.id],
    )
    await client.query(
      `INSERT INTO subscriptions (organization_id, plan_id, status, trial_ends_at, current_period_end, billing_notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (organization_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, trial_ends_at = EXCLUDED.trial_ends_at,
         current_period_end = EXCLUDED.current_period_end, billing_notes = EXCLUDED.billing_notes, updated_at = now()`,
      [request.params.id, plan.rows[0].id, values.status, values.trialEndsAt || null, values.currentPeriodEnd || null, values.billingNotes || ''],
    )
    await audit(client, request.auth, 'updated subscription', 'workspace', organization.rows[0], {
      before: before.rows[0] || null,
      after: { plan: values.plan, status: values.status, trial_ends_at: values.trialEndsAt || null, current_period_end: values.currentPeriodEnd || null },
    })
  })
  const result = await pool.query(`${orgSelect} WHERE o.id = $1`, [request.params.id])
  return response.json({ organization: result.rows[0] })
}))

router.delete('/organizations/:id', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const parsed = z.object({ confirmName: z.string() }).safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  await withTransaction(async (client) => {
    const organization = await client.query('SELECT id, name FROM organizations WHERE id = $1 FOR UPDATE', [request.params.id])
    if (!organization.rowCount) throw new HttpError(404, 'Workspace not found.')
    if (organization.rows[0].name !== parsed.data.confirmName) throw new HttpError(400, 'Type the workspace name exactly to confirm deletion.')
    if (organization.rows[0].id === request.auth.organizationId) throw new HttpError(400, 'You cannot delete the workspace you are signed in to.')
    // Users whose only workspace this is go with it, so their emails can sign up again.
    const orphans = await client.query(
      `SELECT om.user_id FROM organization_members om
       WHERE om.organization_id = $1
         AND NOT EXISTS (SELECT 1 FROM organization_members other WHERE other.user_id = om.user_id AND other.organization_id != $1)`,
      [request.params.id],
    )
    await client.query('DELETE FROM organizations WHERE id = $1', [request.params.id])
    const orphanIds = orphans.rows.map((row) => row.user_id)
    if (orphanIds.length) {
      // Records they created elsewhere keep pointing at them, so only remove users nothing references.
      await client.query(
        `DELETE FROM users u WHERE u.id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM clients WHERE created_by = u.id)
           AND NOT EXISTS (SELECT 1 FROM projects WHERE created_by = u.id)
           AND NOT EXISTS (SELECT 1 FROM tasks WHERE created_by = u.id)
           AND NOT EXISTS (SELECT 1 FROM campaigns WHERE created_by = u.id)
           AND NOT EXISTS (SELECT 1 FROM calendar_events WHERE created_by = u.id)`,
        [orphanIds],
      )
    }
    await audit(client, request.auth, 'deleted workspace', 'workspace', organization.rows[0], { removedUsers: orphanIds.length })
  })
  return response.status(204).end()
}))

router.get('/users', route(async (request, response) => {
  const query = z.object({ q: z.string().max(200).optional() }).parse(request.query)
  const result = await pool.query(
    `SELECT u.id, u.full_name AS "fullName", u.email, u.created_at AS "createdAt",
            om.role, o.id AS "organizationId", o.name AS "organizationName",
            (SELECT max(created_at) FROM user_sessions s WHERE s.user_id = u.id) AS "lastSignInAt"
     FROM users u
     LEFT JOIN organization_members om ON om.user_id = u.id
     LEFT JOIN organizations o ON o.id = om.organization_id
     WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%' OR o.name ILIKE '%' || $1 || '%')
     ORDER BY u.created_at DESC LIMIT 500`,
    [query.q || null],
  )
  return response.json({ users: result.rows })
}))

router.post('/users/:id/reset-link', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const user = await pool.query('SELECT id, full_name AS name, email FROM users WHERE id = $1', [request.params.id])
  if (!user.rowCount) return response.status(404).json({ error: 'User not found.' })
  const { token, tokenHash } = createToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await pool.query(
    'INSERT INTO password_resets (user_id, token_hash, created_by, expires_at) VALUES ($1, $2, $3, $4)',
    [request.params.id, tokenHash, request.auth.userId, expiresAt],
  )
  await audit(pool, request.auth, 'created password reset link', 'user', user.rows[0], { email: user.rows[0].email })
  return response.status(201).json({ link: appUrl(request, `/?reset=${token}`), expiresAt })
}))

router.get('/plans', route(async (_request, response) => {
  const result = await pool.query(
    `${planSelect.replace('FROM subscription_plans', ', (SELECT count(*)::int FROM subscriptions s WHERE s.plan_id = subscription_plans.id) AS workspaces FROM subscription_plans')}
     ORDER BY sort_order, user_limit`,
  )
  return response.json({ plans: result.rows })
}))

router.put('/plans/:name', route(async (request, response) => {
  const parsed = planSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const values = parsed.data
  const result = await pool.query(
    `UPDATE subscription_plans SET user_limit = $1, storage_limit_bytes = $2, project_limit = $3,
            monthly_price = $4, yearly_price = $5, currency = $6, active = $7
     WHERE name = $8 RETURNING id, name`,
    [values.userLimit, Math.round(values.storageLimitGb * 1024 ** 3), values.projectLimit, values.monthlyPrice, values.yearlyPrice, values.currency, values.active, request.params.name],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Plan not found.' })
  await audit(pool, request.auth, 'updated plan', 'plan', result.rows[0], values)
  const plan = await pool.query(`${planSelect} WHERE name = $1`, [request.params.name])
  return response.json({ plan: plan.rows[0] })
}))

router.get('/audit', route(async (_request, response) => {
  const result = await pool.query(
    `SELECT id, admin_email AS "adminEmail", action, target_type AS "targetType", target_name AS "targetName",
            details, created_at AS "createdAt"
     FROM admin_audit_log ORDER BY created_at DESC LIMIT 300`,
  )
  return response.json({ entries: result.rows })
}))

export default router
