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

export function hashToken(token) {
  return createHmac('sha256', process.env.SESSION_SECRET).update(token).digest()
}

export async function createSession(userId, response) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000)
  await pool.query(
    'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expiresAt],
  )
  response.cookie(cookieName, token, sessionCookieOptions(sessionDays * 24 * 60 * 60 * 1000))
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
      `SELECT s.id AS session_id, u.id, u.full_name, u.email, om.organization_id, o.name AS organization_name, om.role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organization_members om ON om.user_id = u.id
       JOIN organizations o ON o.id = om.organization_id
       WHERE s.token_hash = $1 AND s.expires_at > now()
       ORDER BY om.created_at ASC
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
