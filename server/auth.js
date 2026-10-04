import { createHmac, randomBytes } from 'node:crypto'
import { pool } from './db.js'

const cookieName = 'workora_session'
const sessionDays = Number(process.env.SESSION_TTL_DAYS || 7)
const isProduction = process.env.NODE_ENV === 'production'

if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 90) {
  throw new Error('SESSION_TTL_DAYS must be a whole number between 1 and 90.')
}

export function sessionCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge,
  }
}

// Platform (super) admins are named by email in an environment variable, so the
// role can only be granted by whoever controls the deployment's settings.
// Accepts the list however it was typed into the dashboard: commas, semicolons, spaces or
// new lines between addresses, quotes, "Name <email>" or "mailto:" prefixes.
export function platformAdminEmails() {
  const matches = (process.env.PLATFORM_ADMIN_EMAILS || '').match(/[^\s,;<>"'`:]+@[^\s,;<>"'`]+/g) || []
  return matches.map((value) => value.toLowerCase().replace(/\.+$/, ''))
}

export function isPlatformAdmin(email) {
  return platformAdminEmails().includes(String(email).trim().toLowerCase())
}

// The owner's private sign-in lives at a secret path set in ADMIN_PATH. The path is
// checked on the server only, so it never appears in the public JavaScript bundle.
export function adminPath() {
  const value = (process.env.ADMIN_PATH || '').trim().replace(/^\/+|\/+$/g, '')
  // No valid ADMIN_PATH means the private sign-in (and so the console) is switched off.
  return /^[A-Za-z0-9_-]{6,64}$/.test(value) ? value : null
}

export function hashToken(token) {
  return createHmac('sha256', process.env.SESSION_SECRET).update(token).digest()
}

const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000

export async function createSession(userId, response, { platformAdmin = false } = {}) {
  const token = randomBytes(32).toString('base64url')
  // Console sessions are short-lived; workspace sessions last SESSION_TTL_DAYS.
  const maxAge = platformAdmin ? ADMIN_SESSION_MS : sessionDays * 24 * 60 * 60 * 1000
  const expiresAt = new Date(Date.now() + maxAge)
  await pool.query(
    'INSERT INTO user_sessions (token_hash, user_id, expires_at, platform_admin) VALUES ($1, $2, $3, $4)',
    [hashToken(token), userId, expiresAt, platformAdmin],
  )
  response.cookie(cookieName, token, sessionCookieOptions(maxAge))
}

export async function destroySession(request, response) {
  const token = request.cookies[cookieName]
  if (token) {
    await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(token)])
  }
  response.clearCookie(cookieName, sessionCookieOptions(undefined))
}

export async function requireAuth(request, response, next) {
  const token = request.cookies[cookieName]
  if (!token) {
    return response.status(401).json({ error: 'Please sign in to continue.' })
  }

  try {
    const result = await pool.query(
      `SELECT s.id AS session_id, s.platform_admin, u.id, u.full_name, u.email, om.organization_id, o.name AS organization_name, om.role,
              sub.status AS subscription_status
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN organization_members om ON om.user_id = u.id
       LEFT JOIN organizations o ON o.id = om.organization_id
       LEFT JOIN subscriptions sub ON sub.organization_id = om.organization_id
       WHERE s.token_hash = $1 AND s.expires_at > now()
       ORDER BY om.created_at ASC NULLS LAST
       LIMIT 1`,
      [hashToken(token)],
    )
    if (!result.rowCount) {
      return response.status(401).json({ error: 'Your session has expired. Please sign in again.' })
    }

    const row = result.rows[0]
    request.auth = {
      sessionId: row.session_id,
      userId: row.id,
      fullName: row.full_name,
      email: row.email,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      role: row.role,
      // Both conditions: the session came through the private sign-in, and the email is
      // still listed (removing it from PLATFORM_ADMIN_EMAILS revokes access immediately).
      platformAdmin: row.platform_admin && isPlatformAdmin(row.email),
      subscriptionStatus: row.subscription_status,
    }
    // The owner's console account needs no workspace; every other account does.
    if (!row.organization_id && !request.auth.platformAdmin) {
      return response.status(401).json({ error: 'Your session has expired. Please sign in again.' })
    }
    const consolePath = request.originalUrl.startsWith('/api/auth/') || request.originalUrl.startsWith('/api/admin/')
    if (!row.organization_id && !consolePath) {
      return response.status(403).json({ error: 'This account only has access to the owner console.' })
    }
    // A suspended workspace can still sign in and out (so the app can explain why),
    // but every workspace route is closed. Platform admins are never locked out.
    const authPath = request.originalUrl.startsWith('/api/auth/')
    if (row.subscription_status === 'suspended' && !authPath && !request.auth.platformAdmin) {
      return response.status(403).json({ error: 'This workspace has been suspended. Please contact Workora support.', code: 'suspended' })
    }
    return next()
  } catch (error) {
    return next(error)
  }
}

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.auth || !roles.includes(request.auth.role)) {
      return response.status(403).json({ error: 'You do not have permission to perform this action.' })
    }
    return next()
  }
}

export { cookieName }
