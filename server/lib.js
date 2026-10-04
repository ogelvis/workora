import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { pool } from './db.js'
import { hashToken } from './auth.js'

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
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function logActivity(db, auth, action, objectType, objectName) {
  return db.query(
    `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.organizationId, auth.userId, action, objectType, objectName],
  )
}

export function notify(db, organizationId, userId, { title, message = '', resourceType = null, resourceId = null }) {
  return db.query(
    `INSERT INTO notifications (organization_id, user_id, title, message, resource_type, resource_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [organizationId, userId, title, message, resourceType, resourceId],
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

export async function getSubscription(db, organizationId, { lock = false } = {}) {
  const result = await db.query(
    `SELECT s.status, s.trial_ends_at, s.current_period_end, sp.name AS plan_name, sp.user_limit, sp.storage_limit_bytes, sp.project_limit,
            sp.monthly_price::float AS monthly_price, sp.yearly_price::float AS yearly_price, sp.currency
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE s.organization_id = $1
     ${lock ? 'FOR UPDATE OF s' : ''}`,
    [organizationId],
  )
  const row = result.rows[0]
  if (!row) return null
  // Reported to the UI only: without a payment provider there is no way to upgrade,
  // so an ended trial must not lock a workspace out of its own data.
  const trialExpired = row.status === 'trial' && Boolean(row.trial_ends_at) && new Date(row.trial_ends_at) < new Date()
  return { ...row, trialExpired }
}

// Wraps an async route so thrown HttpErrors become JSON responses.
export function route(handler) {
  return async (request, response, next) => {
    try {
      return await handler(request, response, next)
    } catch (error) {
      if (error instanceof HttpError) return response.status(error.status).json({ error: error.message })
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
