import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { adminPath, platformAdminEmails, requireAuth } from '../auth.js'
import { pendingMigrations } from '../migrations.js'
import { HttpError, appUrl, createToken, emailSchema, route, validationError, withTransaction } from '../lib.js'
import { ANNOUNCEMENT_CATEGORIES, announcementEmail, emailConfigured, sendBatch, sendMail, welcomeEmail } from '../mail.js'
import { findIndustry } from '../../shared/industries.js'
import { seedIndustry } from './sheets.js'
import { paystackEnabled } from './billing.js'
import { deleteObjects, newStorageKey, putObject, r2Configured } from '../storage.js'

// Public plan catalogue for the landing page.
export const publicRouter = express.Router()

const planSelect = `
  SELECT name, user_limit AS "userLimit", storage_limit_bytes::float AS "storageLimitBytes",
         project_limit AS "projectLimit", monthly_price::float AS "monthlyPrice",
         yearly_price::float AS "yearlyPrice", currency, active, sort_order AS "sortOrder",
         COALESCE(included_users, user_limit) AS "includedUsers", extra_user_price::float AS "extraUserPrice", features
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
  includedUsers: z.coerce.number().int().min(1).max(2147483647).optional(),
  extraUserPrice: z.coerce.number().min(0).max(999999999).nullable().optional(),
  features: z.object({
    forms: z.number().int().min(0).max(100000).nullable(),
    automations: z.number().int().min(0).max(100000).nullable(),
    reports: z.boolean(),
    chatHistoryDays: z.number().int().min(1).max(36500).nullable(),
  }).optional(),
})

function audit(db, auth, action, targetType, target, details = {}) {
  return db.query(
    `INSERT INTO admin_audit_log (admin_user_id, admin_email, action, target_type, target_id, target_name, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [auth.userId, auth.email, action, targetType, target.id || null, target.name || '', JSON.stringify(details)],
  )
}

const orgSelect = `
  SELECT o.id, o.name, o.business_email AS "businessEmail", o.industry, o.partner, o.created_at AS "createdAt",
         sp.name AS plan, s.status, s.trial_ends_at AS "trialEndsAt", s.current_period_end AS "currentPeriodEnd",
         s.billing_notes AS "billingNotes", sp.monthly_price::float AS "monthlyPrice", sp.currency,
         owner.full_name AS "ownerName", owner.email AS "ownerEmail", owner.id AS "ownerId",
         owner.password_set AS "ownerPasswordSet", owner.email_verified_at AS "ownerVerifiedAt",
         (SELECT count(*)::int FROM organization_members m WHERE m.organization_id = o.id) AS members,
         (SELECT count(*)::int FROM projects p WHERE p.organization_id = o.id) AS projects,
         (SELECT COALESCE(sum(size_bytes), 0)::float FROM files f WHERE f.organization_id = o.id) AS "storageBytes",
         sp.storage_limit_bytes::float AS "storageLimitBytes", sp.user_limit AS "userLimit",
         (SELECT max(created_at) FROM activity_logs a WHERE a.organization_id = o.id) AS "lastActiveAt"
  FROM organizations o
  LEFT JOIN subscriptions s ON s.organization_id = o.id
  LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
  LEFT JOIN LATERAL (
    SELECT u.id, u.full_name, u.email, u.password_set, u.email_verified_at FROM organization_members om JOIN users u ON u.id = om.user_id
    WHERE om.organization_id = o.id AND om.role = 'owner' ORDER BY om.created_at LIMIT 1
  ) owner ON true`

router.get('/overview', route(async (_request, response) => {
  const [totals, byPlan, signups, audits, attention] = await Promise.all([
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
             (SELECT count(*)::int FROM organizations WHERE created_at > now() - interval '30 days') AS "newLast30Days",
             (SELECT count(*)::int FROM organizations WHERE partner) AS partners,
             (SELECT count(*)::int FROM sheet_rows) AS records`),
    pool.query(`
      SELECT sp.name AS plan, count(s.id)::int AS count,
             count(s.id) FILTER (WHERE s.status = 'active')::int AS active,
             COALESCE(sum(sp.monthly_price) FILTER (WHERE s.status = 'active'), 0)::float AS revenue
      FROM subscription_plans sp LEFT JOIN subscriptions s ON s.plan_id = sp.id
      GROUP BY sp.name, sp.sort_order ORDER BY sp.sort_order`),
    pool.query(`
      SELECT to_char(week, 'YYYY-MM-DD') AS week, count(o.id)::int AS count
      FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS week
      LEFT JOIN organizations o ON date_trunc('week', o.created_at) = week
      GROUP BY week ORDER BY week`),
    pool.query(`SELECT id, admin_email AS "adminEmail", action, target_type AS "targetType", target_name AS "targetName", created_at AS "createdAt"
                FROM admin_audit_log ORDER BY created_at DESC LIMIT 8`),
    // Workspaces that need the owner's attention soon, most urgent first.
    pool.query(`
      SELECT o.id, o.name, o.partner, s.status, s.trial_ends_at AS "trialEndsAt", s.current_period_end AS "currentPeriodEnd",
             CASE
               WHEN s.status IN ('past_due', 'expired') THEN 'payment'
               WHEN s.status = 'trial' AND s.trial_ends_at <= now() THEN 'trial_ended'
               WHEN s.status = 'trial' AND s.trial_ends_at <= now() + interval '7 days' THEN 'trial_ending'
               WHEN s.status = 'active' AND s.current_period_end <= now() THEN 'paid_lapsed'
               WHEN s.status = 'active' AND s.current_period_end <= now() + interval '14 days' THEN 'paid_ending'
               WHEN o.partner AND EXISTS (
                 SELECT 1 FROM organization_members om JOIN users u ON u.id = om.user_id
                 WHERE om.organization_id = o.id AND om.role = 'owner' AND u.email_verified_at IS NULL AND NOT u.password_set
               ) THEN 'partner_pending'
             END AS reason
      FROM organizations o JOIN subscriptions s ON s.organization_id = o.id
      WHERE s.status != 'suspended'
      ORDER BY COALESCE(s.current_period_end, s.trial_ends_at, o.created_at)
      LIMIT 200`),
  ])
  return response.json({
    totals: totals.rows[0], byPlan: byPlan.rows, weeklySignups: signups.rows, recentAudit: audits.rows,
    attention: attention.rows.filter((row) => row.reason).slice(0, 12),
  })
}))

router.get('/organizations', route(async (request, response) => {
  const query = z.object({ q: z.string().max(200).optional(), status: z.enum(STATUSES).optional(), partner: z.enum(['1']).optional() }).parse(request.query)
  const result = await pool.query(
    `${orgSelect}
     WHERE ($1::text IS NULL OR o.name ILIKE '%' || $1 || '%' OR o.business_email ILIKE '%' || $1 || '%' OR owner.email ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR s.status = $2)
       AND (NOT $3 OR o.partner)
     ORDER BY o.created_at DESC LIMIT 500`,
    [query.q || null, query.status || null, query.partner === '1'],
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
  let storageKeys = []
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
    const stored = await client.query(
      `SELECT storage_key FROM files WHERE organization_id = $1 AND storage_key IS NOT NULL
       UNION ALL SELECT storage_key FROM chat_attachments WHERE organization_id = $1 AND storage_key IS NOT NULL`,
      [request.params.id],
    )
    storageKeys = stored.rows.map((row) => row.storage_key)
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
  // Their files in cloud storage go too, once the records are gone.
  await deleteObjects(storageKeys)
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Partner businesses

const WELCOME_DAYS = 7

const partnerSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  industry: z.string().trim().max(120).optional(),
  contactName: z.string().trim().min(2).max(120),
  email: emailSchema,
  businessEmail: z.union([emailSchema, z.literal('')]).optional(),
  plan: z.string().trim().min(1).max(60),
  status: z.enum(['active', 'trial']),
  paidUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  billingNotes: z.string().trim().max(2000).optional(),
})

// A single-use link that signs the owner straight into their workspace, then emails it.
async function issueWelcome(db, request, { userId, organizationId, fullName, email, organizationName }) {
  const { token, tokenHash } = createToken()
  const expiresAt = new Date(Date.now() + WELCOME_DAYS * 24 * 60 * 60 * 1000)
  // A new link replaces any unused older one.
  await db.query('UPDATE welcome_links SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId])
  await db.query(
    'INSERT INTO welcome_links (user_id, organization_id, token_hash, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [userId, organizationId, tokenHash, request.auth.userId, expiresAt],
  )
  const link = appUrl(request, `/?welcome=${token}`)
  return { link, expiresAt, send: () => sendMail({ to: email, ...welcomeEmail({ fullName, organizationName, link, expiresAt }) }) }
}

router.get('/email-status', route(async (_request, response) => {
  return response.json({ configured: emailConfigured() })
}))

// Files still kept inside the database (from before cloud storage was set up).
async function storageStatus() {
  const result = await pool.query(
    `SELECT count(*)::int AS count, COALESCE(sum(size_bytes), 0)::float AS bytes FROM (
       SELECT size_bytes FROM files WHERE data IS NOT NULL
       UNION ALL SELECT size_bytes FROM chat_attachments WHERE data IS NOT NULL) stored`,
  )
  return { r2: r2Configured(), bucket: r2Configured() ? (process.env.R2_BUCKET || '').trim() : null, inDatabase: result.rows[0] }
}

// Moves files out of the database into R2, a few at a time so each request finishes quickly.
// The console calls this repeatedly until nothing is left.
router.post('/storage/migrate', route(async (_request, response) => {
  if (!r2Configured()) throw new HttpError(400, 'Set up Cloudflare R2 in Vercel first.')
  let moved = 0
  let budget = 25 * 1024 * 1024
  for (const table of ['files', 'chat_attachments']) {
    while (budget > 0) {
      const next = await pool.query(`SELECT id, organization_id, name, mime_type, data FROM ${table} WHERE data IS NOT NULL ORDER BY size_bytes LIMIT 1`)
      const row = next.rows[0]
      if (!row) break
      const key = newStorageKey(row.organization_id, row.name)
      await putObject(key, row.data, row.mime_type || 'application/octet-stream')
      const updated = await pool.query(`UPDATE ${table} SET storage_key = $1, data = NULL WHERE id = $2 AND data IS NOT NULL`, [key, row.id])
      if (!updated.rowCount) await deleteObjects([key])
      else moved += 1
      budget -= row.data.length
    }
  }
  return response.json({ moved, remaining: (await storageStatus()).inDatabase })
}))

// What's configured and what still needs doing, for the console's System page.
router.get('/system', route(async (_request, response) => {
  const pending = await pendingMigrations().catch(() => null)
  const provider = process.env.RESEND_API_KEY ? 'Resend' : process.env.SMTP_HOST ? `SMTP (${process.env.SMTP_HOST})` : null
  return response.json({
    database: { connected: true, pendingMigrations: pending },
    email: { configured: emailConfigured(), provider, from: (process.env.EMAIL_FROM || '').trim() || null },
    owners: { count: platformAdminEmails().length },
    console: { pathSet: Boolean(adminPath()) },
    supportEmail: (process.env.SUPPORT_EMAIL || '').trim() || null,
    storage: await storageStatus(),
    payments: { paystack: paystackEnabled(), mode: (process.env.PAYSTACK_SECRET_KEY || '').trim().startsWith('sk_live_') ? 'live' : 'test' },
    sessionSecret: true,
  })
}))

router.post('/partners', route(async (request, response) => {
  const parsed = partnerSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const values = parsed.data
  const email = values.email.toLowerCase()
  const industry = findIndustry(values.industry)?.label || values.industry || ''
  const created = await withTransaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [email])
    if (existing.rowCount) throw new HttpError(409, 'Someone already uses this email on OVO. Use a different contact email.')
    const plan = await client.query('SELECT id FROM subscription_plans WHERE name = $1', [values.plan])
    if (!plan.rowCount) throw new HttpError(400, 'That plan does not exist.')
    const organization = await client.query(
      'INSERT INTO organizations (name, business_email, industry, partner) VALUES ($1, $2, $3, true) RETURNING id, name',
      [values.businessName, (values.businessEmail || email).toLowerCase(), industry],
    )
    // No password yet: the owner signs in through the emailed link and chooses one inside.
    const unusable = await bcrypt.hash(randomBytes(32).toString('base64url'), 10)
    const user = await client.query(
      'INSERT INTO users (full_name, email, password_hash, password_set) VALUES ($1, $2, $3, false) RETURNING id',
      [values.contactName, email, unusable],
    )
    const organizationId = organization.rows[0].id
    const userId = user.rows[0].id
    await client.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, [organizationId, userId])
    await client.query(
      `INSERT INTO subscriptions (organization_id, plan_id, status, trial_ends_at, current_period_end, billing_notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [organizationId, plan.rows[0].id, values.status,
        values.status === 'trial' ? new Date(Date.now() + 14 * 86_400_000) : null,
        values.status === 'active' ? values.paidUntil || null : null,
        values.billingNotes || 'Partner business added by OVO.'],
    )
    await client.query(
      `INSERT INTO chat_channels (organization_id, name, description, created_by) VALUES ($1, 'general', 'Company-wide conversation', $2)`,
      [organizationId, userId],
    )
    await seedIndustry(client, { organizationId, userId, industry })
    await client.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name) VALUES ($1, $2, 'created workspace', 'organization', $3)`,
      [organizationId, userId, values.businessName],
    )
    const welcome = await issueWelcome(client, request, { userId, organizationId, fullName: values.contactName, email, organizationName: values.businessName })
    await audit(client, request.auth, 'added partner business', 'workspace', organization.rows[0], { owner: email, plan: values.plan, status: values.status })
    return { organizationId, welcome }
  })
  const delivery = await created.welcome.send()
  const result = await pool.query(`${orgSelect} WHERE o.id = $1`, [created.organizationId])
  return response.status(201).json({
    organization: result.rows[0], link: created.welcome.link, expiresAt: created.welcome.expiresAt,
    emailSent: delivery.sent, emailError: delivery.reason || null,
  })
}))

router.post('/organizations/:id/welcome-link', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const result = await pool.query(`${orgSelect} WHERE o.id = $1`, [request.params.id])
  const organization = result.rows[0]
  if (!organization) throw new HttpError(404, 'Workspace not found.')
  if (!organization.ownerId) throw new HttpError(400, 'This workspace has no owner to send a link to.')
  const welcome = await issueWelcome(pool, request, {
    userId: organization.ownerId, organizationId: organization.id, fullName: organization.ownerName,
    email: organization.ownerEmail, organizationName: organization.name,
  })
  const delivery = await welcome.send()
  await audit(pool, request.auth, 'sent sign-in link', 'workspace', organization, { owner: organization.ownerEmail, emailed: delivery.sent })
  return response.status(201).json({ link: welcome.link, expiresAt: welcome.expiresAt, emailSent: delivery.sent, emailError: delivery.reason || null })
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
            monthly_price = $4, yearly_price = $5, currency = $6, active = $7,
            included_users = LEAST($1, COALESCE($9, included_users, $1)),
            extra_user_price = CASE WHEN $10::boolean THEN $11::numeric ELSE extra_user_price END,
            features = COALESCE($12::jsonb, features)
     WHERE name = $8 RETURNING id, name`,
    [values.userLimit, Math.round(values.storageLimitGb * 1024 ** 3), values.projectLimit, values.monthlyPrice, values.yearlyPrice, values.currency, values.active, request.params.name,
      values.includedUsers ?? null, values.extraUserPrice !== undefined, values.extraUserPrice ?? null, values.features ? JSON.stringify(values.features) : null],
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

// ---------------------------------------------------------------- Revenue
// Money in = Paystack payments (automatic) + income recorded here; money out = expenses recorded here.
const ledgerSchema = z.object({
  kind: z.enum(['inflow', 'outflow']),
  amount: z.coerce.number().positive('Enter an amount above zero.').max(999999999999),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional().default(''),
  occurredOn: z.iso.date(),
  organizationId: z.union([z.uuid(), z.literal('')]).optional(),
})

const transactions = `
  SELECT p.id, 'inflow' AS kind, p.amount_minor::float / 100 AS amount, p.currency, 'Subscriptions' AS category,
         p.plan_name || ' plan · ' || p.billing_interval || ' (Paystack)' AS description,
         (p.paid_at AT TIME ZONE 'UTC')::date AS "occurredOn", o.name AS organization, 'paystack' AS source, p.paid_at AS "createdAt"
  FROM payments p LEFT JOIN organizations o ON o.id = p.organization_id WHERE p.status = 'success'
  UNION ALL
  SELECT l.id, l.kind, l.amount::float, l.currency, l.category, l.description, l.occurred_on, o.name, 'manual', l.created_at
  FROM platform_ledger l LEFT JOIN organizations o ON o.id = l.organization_id`

router.get('/revenue', route(async (_request, response) => {
  const [monthly, totals, recent, mrr, categories] = await Promise.all([
    pool.query(
      `WITH months AS (
         SELECT generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month')::date AS month
       ), t AS (${transactions})
       SELECT to_char(m.month, 'YYYY-MM') AS month,
              COALESCE(sum(t.amount) FILTER (WHERE t.kind = 'inflow'), 0)::float AS inflow,
              COALESCE(sum(t.amount) FILTER (WHERE t.kind = 'outflow'), 0)::float AS outflow
       FROM months m LEFT JOIN t ON date_trunc('month', t."occurredOn") = m.month
       GROUP BY m.month ORDER BY m.month`,
    ),
    pool.query(
      `WITH t AS (${transactions})
       SELECT
         COALESCE(sum(amount) FILTER (WHERE kind = 'inflow' AND "occurredOn" >= date_trunc('month', CURRENT_DATE)), 0)::float AS "inflowThisMonth",
         COALESCE(sum(amount) FILTER (WHERE kind = 'outflow' AND "occurredOn" >= date_trunc('month', CURRENT_DATE)), 0)::float AS "outflowThisMonth",
         COALESCE(sum(amount) FILTER (WHERE kind = 'inflow' AND "occurredOn" >= date_trunc('month', CURRENT_DATE) - interval '1 month' AND "occurredOn" < date_trunc('month', CURRENT_DATE)), 0)::float AS "inflowLastMonth",
         COALESCE(sum(amount) FILTER (WHERE kind = 'outflow' AND "occurredOn" >= date_trunc('month', CURRENT_DATE) - interval '1 month' AND "occurredOn" < date_trunc('month', CURRENT_DATE)), 0)::float AS "outflowLastMonth",
         COALESCE(sum(amount) FILTER (WHERE kind = 'inflow' AND "occurredOn" >= date_trunc('year', CURRENT_DATE)), 0)::float AS "inflowYear",
         COALESCE(sum(amount) FILTER (WHERE kind = 'outflow' AND "occurredOn" >= date_trunc('year', CURRENT_DATE)), 0)::float AS "outflowYear",
         COALESCE(sum(amount) FILTER (WHERE kind = 'inflow'), 0)::float AS "inflowAll",
         COALESCE(sum(amount) FILTER (WHERE kind = 'outflow'), 0)::float AS "outflowAll"
       FROM t`,
    ),
    pool.query(`SELECT * FROM (${transactions}) t ORDER BY "occurredOn" DESC, "createdAt" DESC LIMIT 200`),
    // Monthly recurring revenue: each workspace's latest paid period that is still running, as a monthly amount.
    pool.query(
      `SELECT COALESCE(sum(CASE WHEN billing_interval = 'yearly' THEN amount_minor::float / 1200 ELSE amount_minor::float / 100 END), 0)::float AS mrr,
              count(*)::int AS paying
       FROM (SELECT DISTINCT ON (organization_id) * FROM payments WHERE status = 'success' ORDER BY organization_id, paid_at DESC) latest
       WHERE period_end > now()`,
    ),
    pool.query(
      `SELECT category, kind, sum(amount)::float AS total FROM (${transactions}) t
       WHERE "occurredOn" >= date_trunc('year', CURRENT_DATE) GROUP BY category, kind ORDER BY total DESC`,
    ),
  ])
  return response.json({
    monthly: monthly.rows,
    totals: totals.rows[0],
    mrr: mrr.rows[0].mrr,
    payingWorkspaces: mrr.rows[0].paying,
    categories: categories.rows,
    transactions: recent.rows,
    currency: 'NGN',
  })
}))

router.post('/ledger', route(async (request, response) => {
  const values = ledgerSchema.parse(request.body)
  const result = await pool.query(
    `INSERT INTO platform_ledger (kind, amount, category, description, occurred_on, organization_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [values.kind, values.amount, values.category, values.description, values.occurredOn, values.organizationId || null, request.auth.userId],
  )
  await audit(pool, request.auth, values.kind === 'inflow' ? 'recorded income' : 'recorded an expense', 'ledger', { id: result.rows[0].id, name: `${values.category} ${values.amount}` }, values)
  return response.status(201).json({ id: result.rows[0].id })
}))

router.delete('/ledger/:id', route(async (request, response) => {
  z.uuid().parse(request.params.id)
  const result = await pool.query('DELETE FROM platform_ledger WHERE id = $1 RETURNING kind, category, amount', [request.params.id])
  if (!result.rowCount) throw new HttpError(404, 'Entry not found. Paystack payments can’t be deleted here.')
  await audit(pool, request.auth, 'deleted a ledger entry', 'ledger', { id: request.params.id, name: `${result.rows[0].category} ${result.rows[0].amount}` })
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Announcements
const announcementSchema = z.object({
  category: z.enum(Object.keys(ANNOUNCEMENT_CATEGORIES)),
  audience: z.enum(['everyone', 'admins', 'owners']),
  title: z.string().trim().min(1, 'Add a title.').max(150),
  body: z.string().trim().min(1, 'Write the message.').max(10000),
  ctaLabel: z.string().trim().max(40).optional().default(''),
  ctaUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(500)]).optional().default(''),
})
const AUDIENCE_ROLES = { everyone: ['owner', 'admin', 'manager', 'staff'], admins: ['owner', 'admin'], owners: ['owner'] }

// One row per person (someone in two workspaces gets one email); product updates respect opt-outs.
function recipients(db, values) {
  return db.query(
    `SELECT DISTINCT ON (u.id) u.id, u.full_name AS "fullName", u.email
     FROM users u JOIN organization_members om ON om.user_id = u.id
     WHERE om.role = ANY($1) AND ($2 OR u.product_updates)
     ORDER BY u.id, om.created_at`,
    [AUDIENCE_ROLES[values.audience], values.category !== 'product'],
  )
}

function renderAnnouncement(request, values, fullName) {
  return announcementEmail({
    ...values,
    ctaLabel: values.ctaUrl ? values.ctaLabel || 'Learn more' : '',
    fullName,
    appUrl: appUrl(request, '/'),
    preferencesUrl: appUrl(request, '/#/settings?tab=account'),
  })
}

router.get('/announcements', route(async (_request, response) => {
  const result = await pool.query(
    `SELECT a.id, a.category, a.audience, a.title, a.body, a.cta_label AS "ctaLabel", a.cta_url AS "ctaUrl",
            a.recipient_count AS "recipientCount", a.emailed_count AS "emailedCount", a.failed_count AS "failedCount",
            a.sent_at AS "sentAt", u.email AS "sentBy"
     FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.sent_at DESC LIMIT 100`,
  )
  return response.json({ announcements: result.rows, emailConfigured: emailConfigured() })
}))

router.post('/announcements/preview', route(async (request, response) => {
  const values = announcementSchema.parse(request.body)
  const people = await recipients(pool, values)
  const email = renderAnnouncement(request, values, request.auth.fullName)
  return response.json({ subject: email.subject, html: email.html, recipients: people.rowCount })
}))

router.post('/announcements/test', route(async (request, response) => {
  const values = announcementSchema.parse(request.body)
  const result = await sendMail({ to: request.auth.email, ...renderAnnouncement(request, values, request.auth.fullName) })
  if (!result.sent) throw new HttpError(400, result.reason)
  return response.json({ sentTo: request.auth.email })
}))

router.post('/announcements', route(async (request, response) => {
  const values = announcementSchema.parse(request.body)
  const people = (await recipients(pool, values)).rows
  if (!people.length) throw new HttpError(400, 'Nobody matches this audience yet.')
  const announcement = await withTransaction(async (client) => {
    const created = await client.query(
      `INSERT INTO announcements (category, audience, title, body, cta_label, cta_url, recipient_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [values.category, values.audience, values.title, values.body, values.ctaUrl ? values.ctaLabel || 'Learn more' : null, values.ctaUrl || null, people.length, request.auth.userId],
    )
    const id = created.rows[0].id
    // Everyone also sees it inside OVO, so the message lands even without email.
    await client.query(
      `INSERT INTO notifications (organization_id, user_id, title, message, resource_type, resource_id, link)
       SELECT om.organization_id, om.user_id, $1, $2, 'announcement', $3, $4
       FROM organization_members om JOIN users u ON u.id = om.user_id
       WHERE om.role = ANY($5) AND ($6 OR u.product_updates)`,
      [`${ANNOUNCEMENT_CATEGORIES[values.category].label}: ${values.title}`, values.body.slice(0, 280), id, `#/updates?id=${id}`, AUDIENCE_ROLES[values.audience], values.category !== 'product'],
    )
    await audit(client, request.auth, 'sent announcement', 'announcement', { id, name: values.title }, { category: values.category, audience: values.audience, recipients: people.length })
    return id
  })
  const result = await sendBatch(people.map((person) => ({ to: person.email, ...renderAnnouncement(request, values, person.fullName) })))
  await pool.query('UPDATE announcements SET emailed_count = $1, failed_count = $2 WHERE id = $3', [result.sent, result.failed, announcement])
  return response.status(201).json({ id: announcement, recipients: people.length, emailed: result.sent, failed: result.failed, emailConfigured: emailConfigured() })
}))

export default router
