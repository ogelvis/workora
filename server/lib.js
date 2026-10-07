import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { pool } from './db.js'
import { hashToken } from './auth.js'
import { hasVideoSignature, looksLikeVideo } from '../shared/media.js'

export const MANAGERS = ['owner', 'admin', 'manager']
export const ADMINS = ['owner', 'admin']

export const emailSchema = z.string().trim().email().max(254)
export const passwordSchema = z.string().min(12, 'Passwords must be at least 12 characters.').max(128)
export const optionalDate = z.union([z.iso.date(), z.literal('')]).optional().nullable()
export const optionalId = z.union([z.uuid(), z.literal('')]).optional().nullable()

export function validationError(response, error) {
  return response.status(400).json({
    error: error.issues?.[0]?.message || 'Please check the submitted information.',
  })
}

// Runs `work` inside a transaction on a dedicated client and always releases it.
export async function withTransaction(work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('Could not roll back transaction:', rollbackError)
    }
    throw error
  } finally {
    client.release()
  }
}

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function logActivity(db, auth, action, objectType, objectName) {
  return db.query(
    `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.organizationId, auth.userId, action, objectType, objectName],
  )
}

export function notify(db, organizationId, userId, { title, message = '', resourceType = null, resourceId = null, link = null }) {
  return db.query(
    `INSERT INTO notifications (organization_id, user_id, title, message, resource_type, resource_id, link)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [organizationId, userId, title, message, resourceType, resourceId, link],
  )
}

// Ensures an optional linked record belongs to the caller's organization.
export async function assertInOrg(db, table, id, organizationId, label) {
  if (!id) return
  const tables = { clients: 'clients', projects: 'projects' }
  const result = await db.query(
    `SELECT 1 FROM ${tables[table]} WHERE id = $1 AND organization_id = $2`,
    [id, organizationId],
  )
  if (!result.rowCount) throw new HttpError(404, `${label} not found in this workspace.`)
}

export async function assertMember(db, userId, organizationId) {
  if (!userId) return
  const result = await db.query(
    'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  )
  if (!result.rowCount) throw new HttpError(404, 'Assignee not found in this workspace.')
}

export function createToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

// Days a paid plan keeps working after its period ends, before it drops to Free.
export const GRACE_DAYS = 7

// Plan features; a missing or null limit means unlimited.
export function planFeatures(features) {
  const value = features || {}
  return {
    forms: value.forms ?? null,
    automations: value.automations ?? null,
    reports: value.reports ?? true,
    chatHistoryDays: value.chatHistoryDays ?? null,
    // Video uploads are an Enterprise feature; plans that don't say otherwise don't include them.
    videos: value.videos ?? false,
  }
}

const subscriptionQuery = (lock) => `
  SELECT s.status, s.trial_ends_at, s.current_period_end, s.seats, sp.name AS plan_name, sp.user_limit, sp.storage_limit_bytes, sp.project_limit,
         sp.monthly_price::float AS monthly_price, sp.yearly_price::float AS yearly_price, sp.currency,
         sp.included_users, sp.extra_user_price::float AS extra_user_price, sp.features
  FROM subscriptions s
  JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.organization_id = $1
  ${lock ? 'FOR UPDATE OF s' : ''}`

export async function getSubscription(db, organizationId, { lock = false } = {}) {
  let row = (await db.query(subscriptionQuery(lock), [organizationId])).rows[0]
  if (!row) return null
  const now = Date.now()
  const trialOver = row.status === 'trial' && Boolean(row.trial_ends_at) && new Date(row.trial_ends_at).getTime() < now
  const lapsed = row.status === 'active' && row.plan_name !== 'Free' && Boolean(row.current_period_end)
    && new Date(row.current_period_end).getTime() + GRACE_DAYS * 86400000 < now
  // An ended trial or an unpaid plan moves to Free: the workspace keeps its data, with Free's limits.
  if (trialOver || lapsed) {
    const moved = await db.query(
      `UPDATE subscriptions SET plan_id = free.id, status = 'active', seats = NULL, current_period_end = NULL
       FROM subscription_plans free WHERE free.name = 'Free' AND subscriptions.organization_id = $1 RETURNING subscriptions.id`,
      [organizationId],
    )
    if (moved.rowCount) row = (await db.query(subscriptionQuery(false), [organizationId])).rows[0]
  }
  const stillTrialExpired = row.status === 'trial' && Boolean(row.trial_ends_at) && new Date(row.trial_ends_at).getTime() < now
  const included = row.included_users ?? row.user_limit
  // Paid plans can buy extra people; the plan's user_limit is the hard ceiling.
  const memberLimit = Math.min(row.user_limit, Math.max(included, row.status === 'active' ? row.seats || 0 : 0))
  return { ...row, trialExpired: stillTrialExpired, memberLimit, features: planFeatures(row.features), isFree: row.plan_name === 'Free' }
}

export async function featuresFor(db, organizationId) {
  const subscription = await getSubscription(db, organizationId)
  return subscription ? subscription.features : planFeatures(null)
}

// Stops creating another form or automation past the plan's allowance.
export async function assertPlanCount(db, organizationId, key, table, noun) {
  const subscription = await getSubscription(db, organizationId)
  const limit = subscription?.features[key]
  if (limit === null || limit === undefined) return
  const count = await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`, [organizationId])
  if (count.rows[0].count >= limit) {
    throw new HttpError(403, `The ${subscription.plan_name} plan includes ${limit} ${limit === 1 ? noun : `${noun}s`}. Upgrade your plan in Billing to add more.`, 'upgrade')
  }
}

// Refuses a video on plans without video uploads. Checks the name and type, and the
// first bytes of the file when we have them (so renaming a video doesn't get round it).
export async function assertVideoAllowed(db, organizationId, { name, mimeType, head }) {
  if (!looksLikeVideo(name, mimeType) && !hasVideoSignature(head)) return
  const subscription = await getSubscription(db, organizationId)
  if (subscription?.features.videos) return
  throw new HttpError(403, 'Video uploads are part of the Enterprise plan. Contact OVO to upgrade, or share a link to the video instead.', 'upgrade')
}

// Wraps an async route so thrown HttpErrors become JSON responses.
export function route(handler) {
  return async (request, response, next) => {
    try {
      return await handler(request, response, next)
    } catch (error) {
      if (error instanceof HttpError) return response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) })
      if (error instanceof z.ZodError) return validationError(response, error)
      // invalid_text_representation: a malformed UUID in the URL can never match a record.
      if (error.code === '22P02') return response.status(404).json({ error: 'That record could not be found.' })
      if (error.code === '23505') return response.status(409).json({ error: 'That record already exists.' })
      return next(error)
    }
  }
}

export function appUrl(request, path) {
  return `${request.protocol}://${request.get('host')}${path}`
}
