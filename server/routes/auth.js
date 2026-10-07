import { createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import express from 'express'
import { avatarUrl } from './profile.js'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { pool } from '../db.js'
import { adminPath, createSession, destroySession, displayEmail, hashToken, isPlatformAdmin, platformAdminEmails, requireAuth } from '../auth.js'
import { seedIndustry } from './sheets.js'
import { emailChangedEmail, emailConfigured, ownerResetEmail, passwordResetEmail, sendMail, verifyEmailChangeEmail } from '../mail.js'
import { findIndustry } from '../../shared/industries.js'
import { TERMS_VERSION } from '../../shared/legal.js'
import {
  HttpError, createToken, appUrl, emailSchema, getSubscription, logActivity, notify, passwordSchema, route,
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
  industry: z.string().trim().max(120).optional(),
  businessEmail: emailSchema,
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'Please accept the Terms of Use and Privacy Policy to continue.' }),
})

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  fullName: z.string().trim().min(2).max(120),
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'Please accept the Terms of Use and Privacy Policy to continue.' }),
})

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
})

const changePasswordSchema = z.object({
  // Accounts created by OVO for partners have no password yet, so there is nothing to confirm.
  currentPassword: z.string().max(128).optional(),
  newPassword: passwordSchema,
})

function accountPayload({ userId, fullName, email, organizationId, organizationName, role }) {
  return {
    user: { id: userId, fullName, email: displayEmail(email) },
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
    const existingUser = await client.query(
      `SELECT u.id, u.password_hash, EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id) AS has_workspace
       FROM users u WHERE u.email = $1`,
      [email],
    )
    const existing = existingUser.rows[0]
    // The owner's console account has no workspace yet; it can create one with its own password.
    const reuse = existing && !existing.has_workspace && await bcrypt.compare(values.password, existing.password_hash)
    if (existing && !reuse) throw new HttpError(409, 'An account with this email already exists. Sign in instead.')
    const industry = findIndustry(values.industry)?.label || values.industry || ''
    const organization = await client.query(
      'INSERT INTO organizations (name, business_email, industry) VALUES ($1, $2, $3) RETURNING id, name, industry',
      [values.organizationName, values.businessEmail.toLowerCase(), industry],
    )
    const user = reuse
      ? await client.query('UPDATE users SET terms_accepted_at = now(), terms_version = $2 WHERE id = $1 RETURNING id, full_name, email', [existing.id, TERMS_VERSION])
      : await client.query(
        'INSERT INTO users (full_name, email, password_hash, terms_accepted_at, terms_version) VALUES ($1, $2, $3, now(), $4) RETURNING id, full_name, email',
        [values.fullName, email, passwordHash, TERMS_VERSION],
      )
    const organizationId = organization.rows[0].id
    const userId = user.rows[0].id
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [organizationId, userId],
    )
    await client.query(
      `INSERT INTO subscriptions (organization_id, plan_id, status)
       SELECT $1, id, 'trial' FROM subscription_plans WHERE name = (CASE WHEN EXISTS (SELECT 1 FROM subscription_plans WHERE name = 'Free') THEN 'Business' ELSE 'Starter' END)`,
      [organizationId],
    )
    await client.query(
      `INSERT INTO chat_channels (organization_id, name, description, created_by)
       VALUES ($1, 'general', 'Company-wide conversation', $2)`,
      [organizationId, userId],
    )
    // The workspace starts with the modules its industry needs.
    await seedIndustry(client, { organizationId, userId, industry })
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
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.password_set, om.organization_id,
            o.name AS organization_name, om.role
     FROM users u
     LEFT JOIN organization_members om ON om.user_id = u.id
     LEFT JOIN organizations o ON o.id = om.organization_id
     WHERE u.email = $1
     ORDER BY om.created_at ASC NULLS LAST
     LIMIT 1`,
    [parsed.data.email.toLowerCase()],
  )
  const row = result.rows[0]
  // Sign-up already reveals whether an email is taken, so naming the problem here
  // costs nothing and saves people guessing.
  if (!row) {
    return response.status(401).json({ error: 'No OVO account uses this email. Check the spelling or create a workspace.', code: 'no_account' })
  }
  if (!row.password_set) {
    return response.status(401).json({ error: 'This account hasn’t chosen a password yet. Open the sign-in link from your OVO welcome email, or ask OVO support to send a new one.', code: 'no_password' })
  }
  if (!(await bcrypt.compare(parsed.data.password, row.password_hash))) {
    return response.status(401).json({ error: 'That password is incorrect. Ask your workspace admin for a reset link if you’ve forgotten it.', code: 'wrong_password' })
  }
  if (!row.organization_id) {
    return response.status(401).json({ error: 'This account isn’t in a workspace yet. Create a workspace with the same email and password.', code: 'no_workspace' })
  }
  await createSession(row.id, response)
  const account = {
    userId: row.id, fullName: row.full_name, email: row.email,
    organizationId: row.organization_id, organizationName: row.organization_name, role: row.role,
  }
  await logActivity(pool, account, 'signed in', 'user', row.full_name)
  return response.json(accountPayload(account))
}))

// ---------------------------------------------------------------- Owner's private sign-in

const gatewaySchema = z.object({ path: z.string().max(100) })

function isGatewayPath(path) {
  const secret = adminPath()
  return Boolean(secret) && typeof path === 'string' && path.replace(/^\/+|\/+$/g, '').toLowerCase() === secret.toLowerCase()
}

// Lets the app ask whether an address is the private sign-in, without the path ever
// being shipped to browsers. Rate-limited so it cannot be used to guess the path.
const gatewayLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Not found.' },
})

router.get('/gateway/:path', gatewayLimiter, (request, response) => {
  return isGatewayPath(request.params.path)
    ? response.status(204).end()
    : response.status(404).json({ error: 'Not found.' })
})

router.post('/console-login', authLimiter, route(async (request, response) => {
  const parsed = loginSchema.extend(gatewaySchema.shape).safeParse(request.body)
  // The person signing in always sees the same message; the real reason goes to the
  // server log (Vercel → Logs) so the owner can diagnose a misconfiguration.
  const invalid = (reason) => {
    console.warn(`Console sign-in refused: ${reason}`)
    return response.status(401).json({ error: 'Email or password is incorrect.' })
  }
  if (!parsed.success) return invalid('the form was incomplete or the email was not valid')
  if (!isGatewayPath(parsed.data.path)) return invalid('the sign-in page address does not match ADMIN_PATH')
  const email = parsed.data.email.toLowerCase()
  if (!isPlatformAdmin(email)) {
    return invalid(`this email is not in PLATFORM_ADMIN_EMAILS (${platformAdminEmails().length} address(es) configured)`)
  }
  const result = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email])
  const user = result.rows[0]
  if (!user) return invalid('no account uses this email yet; set up owner access first')
  if (!(await bcrypt.compare(parsed.data.password, user.password_hash))) return invalid('wrong password')
  await startConsoleSession(user.id, email, 'signed in to the console', response)
  return response.json({ ok: true })
}))

async function startConsoleSession(userId, email, action, response) {
  await createSession(userId, response, { platformAdmin: true })
  await pool.query(
    `INSERT INTO admin_audit_log (admin_user_id, admin_email, action, target_type, target_name)
     VALUES ($1, $2, $3, 'console', '')`,
    [userId, email, action],
  )
}

// Tells the private sign-in page which form to show. Only answers on the secret path.
router.post('/console-status', gatewayLimiter, route(async (request, response) => {
  const parsed = gatewaySchema.safeParse(request.body)
  if (!parsed.success || !isGatewayPath(parsed.data.path)) return response.status(404).json({ error: 'Not found.' })
  const emails = platformAdminEmails()
  if (!emails.length) return response.json({ configured: false, setupNeeded: false })
  const existing = await pool.query('SELECT 1 FROM users WHERE email = ANY($1::text[]) LIMIT 1', [emails])
  return response.json({ configured: true, setupNeeded: !existing.rowCount })
}))

const consoleSetupSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
}).extend(gatewaySchema.shape)

// ---------------------------------------------------------------- Owner password recovery

const RESET_MINUTES = 60

// Emails a one-hour reset link to a listed owner address. The answer is the same whether
// or not the address is an owner, so this page can't be used to discover who is.
router.post('/console-forgot', authLimiter, route(async (request, response) => {
  const parsed = z.object({ email: emailSchema }).extend(gatewaySchema.shape).safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  if (!isGatewayPath(parsed.data.path)) return response.status(404).json({ error: 'Not found.' })
  if (!emailConfigured()) return response.json({ emailConfigured: false })
  const email = parsed.data.email.toLowerCase()
  if (isPlatformAdmin(email)) {
    const user = await pool.query('SELECT id, full_name FROM users WHERE email = $1', [email])
    if (user.rowCount) {
      const { token, tokenHash } = createToken()
      const expiresAt = new Date(Date.now() + RESET_MINUTES * 60 * 1000)
      await pool.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.rows[0].id])
      await pool.query('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [user.rows[0].id, tokenHash, expiresAt])
      // The token travels in the #fragment, so it never reaches server logs.
      const link = appUrl(request, `/${adminPath()}#reset=${token}`)
      const delivery = await sendMail({ to: email, ...ownerResetEmail({ fullName: user.rows[0].full_name, link }) })
      if (!delivery.sent) console.warn(`Owner reset email not sent: ${delivery.reason}`)
    } else {
      console.warn('Owner reset requested for a listed email with no account yet')
    }
  } else {
    console.warn('Owner reset requested for an email not in PLATFORM_ADMIN_EMAILS')
  }
  return response.json({ emailConfigured: true })
}))

router.post('/console-reset', authLimiter, route(async (request, response) => {
  const parsed = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).extend(gatewaySchema.shape).safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  if (!isGatewayPath(parsed.data.path)) return response.status(404).json({ error: 'Not found.' })
  const passwordHash = await bcrypt.hash(parsed.data.password, 12)
  const user = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT r.id, r.user_id, r.expires_at, r.used_at, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = $1 FOR UPDATE OF r`,
      [hashToken(parsed.data.token)],
    )
    const reset = result.rows[0]
    if (!reset || reset.used_at || new Date(reset.expires_at) < new Date() || !isPlatformAdmin(reset.email)) {
      throw new HttpError(410, 'This reset link is invalid or has expired. Request a new one.')
    }
    await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id])
    await client.query('UPDATE users SET password_hash = $1, password_set = true WHERE id = $2', [passwordHash, reset.user_id])
    // Every existing session ends; whoever had the old password is signed out.
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [reset.user_id])
    return { id: reset.user_id, email: reset.email }
  })
  await startConsoleSession(user.id, user.email, 'reset the owner password', response)
  return response.json({ ok: true })
}))

// First-time owner setup: an address in PLATFORM_ADMIN_EMAILS that has no account yet
// chooses its password here. Once the account exists this always refuses, so it can't
// be used to take over the owner's access.
router.post('/console-setup', authLimiter, route(async (request, response) => {
  const parsed = consoleSetupSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  if (!isGatewayPath(parsed.data.path)) return response.status(404).json({ error: 'Not found.' })
  const email = parsed.data.email.toLowerCase()
  if (!isPlatformAdmin(email)) {
    return response.status(403).json({ error: 'This email isn’t an owner address. Use the email set in PLATFORM_ADMIN_EMAILS.' })
  }
  const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [email])
  if (existing.rowCount) {
    return response.status(409).json({ error: 'Owner access is already set up for this email. Sign in instead.', code: 'exists' })
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12)
  const user = await pool.query(
    'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [parsed.data.fullName, email, passwordHash],
  )
  await startConsoleSession(user.rows[0].id, email, 'set up owner access', response)
  return response.status(201).json({ ok: true })
}))

// ---------------------------------------------------------------- Partner welcome links

// The emailed link signs the owner straight into their workspace, once.
router.post('/welcome', authLimiter, route(async (request, response) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(request.body)
  const userId = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT w.id, w.user_id, w.expires_at, w.used_at FROM welcome_links w WHERE w.token_hash = $1 FOR UPDATE`,
      [hashToken(token)],
    )
    const link = result.rows[0]
    if (!link) throw new HttpError(404, 'This sign-in link isn’t valid. Ask OVO support for a new one.')
    if (link.used_at) throw new HttpError(410, 'This sign-in link has already been used. Sign in with your password, or ask OVO support for a new link.')
    if (new Date(link.expires_at) < new Date()) throw new HttpError(410, 'This sign-in link has expired. Ask OVO support for a new one.')
    await client.query('UPDATE welcome_links SET used_at = now() WHERE id = $1', [link.id])
    await client.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [link.user_id])
    return link.user_id
  })
  await createSession(userId, response)
  return response.json({ ok: true })
}))

router.post('/logout', route(async (request, response) => {
  await destroySession(request, response)
  return response.status(204).end()
}))

router.get('/me', requireAuth, route(async (request, response) => {
  const [subscription, user] = await Promise.all([
    getSubscription(pool, request.auth.organizationId),
    pool.query(
      `SELECT u.password_set, u.product_updates, u.terms_version, ${profileColumns},
              (SELECT updated_at FROM user_avatars a WHERE a.user_id = u.id) AS avatar_at
       FROM users u WHERE u.id = $1`,
      [request.auth.userId],
    ),
  ])
  const account = accountPayload(request.auth)
  const me = user.rows[0] || {}
  return response.json({
    ...account,
    user: { ...account.user, avatarUrl: avatarUrl(request.auth.userId, me.avatar_at), phone: me.phone ?? null, jobTitle: me.jobTitle ?? null, dateOfBirth: me.dateOfBirth ?? null },
    organization: { id: request.auth.organizationId, name: request.auth.organizationName, industry: request.auth.organizationIndustry },
    platformAdmin: request.auth.platformAdmin,
    passwordSet: user.rows[0]?.password_set ?? true,
    productUpdates: user.rows[0]?.product_updates ?? true,
    termsAccepted: user.rows[0]?.terms_version === TERMS_VERSION,
    termsVersion: TERMS_VERSION,
    subscription: subscription && {
      plan: subscription.plan_name,
      status: subscription.status,
      trialEndsAt: subscription.trial_ends_at,
      trialExpired: subscription.trialExpired,
      currentPeriodEnd: subscription.current_period_end,
      features: subscription.features,
      isFree: subscription.isFree,
    },
  })
}))

router.post('/change-password', requireAuth, authLimiter, route(async (request, response) => {
  const parsed = changePasswordSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const user = await pool.query('SELECT password_hash, password_set FROM users WHERE id = $1', [request.auth.userId])
  if (user.rows[0].password_set && !(await bcrypt.compare(parsed.data.currentPassword || '', user.rows[0].password_hash))) {
    return response.status(400).json({ error: 'Your current password is incorrect.' })
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)
  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $1, password_set = true WHERE id = $2', [passwordHash, request.auth.userId])
    await client.query('DELETE FROM user_sessions WHERE user_id = $1 AND id != $2', [request.auth.userId, request.auth.sessionId])
    if (request.auth.organizationId) await logActivity(client, request.auth, 'changed their password', 'user', request.auth.fullName)
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

// People who joined before the current terms (or before terms existed) accept them once here.
router.post('/accept-terms', requireAuth, route(async (request, response) => {
  z.object({ version: z.literal(TERMS_VERSION, { error: 'These terms have been updated. Reload the page to see the latest version.' }) }).parse(request.body)
  await pool.query('UPDATE users SET terms_accepted_at = now(), terms_version = $1 WHERE id = $2', [TERMS_VERSION, request.auth.userId])
  if (request.auth.organizationId) await logActivity(pool, request.auth, 'accepted the Terms of Use and Privacy Policy', 'user', request.auth.fullName)
  return response.json({ termsAccepted: true })
}))

// ---------------------------------------------------------------- My account
// Empty text clears a detail; leaving a field out keeps it as it is.
const optionalText = (max, message) => z.string().trim().max(max, message).optional()
const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120).optional(),
  productUpdates: z.boolean().optional(),
  phone: optionalText(30, 'That phone number is too long.').refine((value) => !value || /^\+?[0-9\s()-]{7,20}$/.test(value), 'Enter a phone number using digits, spaces and an optional + at the start.'),
  jobTitle: optionalText(80, 'Keep your job title under 80 characters.'),
  dateOfBirth: z.union([z.literal(''), z.iso.date()]).optional().refine((value) => {
    if (!value) return true
    const date = new Date(`${value}T00:00:00Z`)
    const age = (Date.now() - date.getTime()) / (365.25 * 86400000)
    return age >= 13 && age <= 110
  }, 'Enter a real date of birth.'),
})

export const profileColumns = `u.phone, u.job_title AS "jobTitle", to_char(u.date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth"`

router.put('/profile', requireAuth, route(async (request, response) => {
  const values = profileSchema.parse(request.body)
  // A column set to itself keeps its value; '' clears it.
  const keep = (value) => (value === undefined ? null : value === '' ? '' : value)
  const result = await pool.query(
    `UPDATE users u SET full_name = COALESCE($1, full_name), product_updates = COALESCE($2, product_updates),
       phone = CASE WHEN $3::text IS NULL THEN phone ELSE NULLIF($3, '') END,
       job_title = CASE WHEN $4::text IS NULL THEN job_title ELSE NULLIF($4, '') END,
       date_of_birth = CASE WHEN $5::text IS NULL THEN date_of_birth ELSE NULLIF($5, '')::date END
     WHERE id = $6 RETURNING full_name, product_updates, ${profileColumns}`,
    [values.fullName ?? null, values.productUpdates ?? null, keep(values.phone), keep(values.jobTitle), keep(values.dateOfBirth), request.auth.userId],
  )
  const row = result.rows[0]
  const changedDetails = ['fullName', 'phone', 'jobTitle', 'dateOfBirth'].some((key) => values[key] !== undefined)
  if (changedDetails && request.auth.organizationId) await logActivity(pool, request.auth, 'updated their profile', 'user', row.full_name)
  return response.json({
    user: { id: request.auth.userId, fullName: row.full_name, email: displayEmail(request.auth.email) },
    profile: { phone: row.phone, jobTitle: row.jobTitle, dateOfBirth: row.dateOfBirth },
    productUpdates: row.product_updates,
  })
}))

// Email-change links are signed rather than stored: they carry the user, the new address and
// the address they replace, so a link stops working as soon as the email changes again.
const EMAIL_CHANGE_MS = 24 * 60 * 60 * 1000
function signEmailChange(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', process.env.SESSION_SECRET).update(`email-change.${body}`).digest('base64url')
  return `${body}.${signature}`
}
function readEmailChange(token) {
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature) return null
  const expected = createHmac('sha256', process.env.SESSION_SECRET).update(`email-change.${body}`).digest()
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return payload.exp > Date.now() ? payload : null
  } catch {
    return null
  }
}

async function applyEmailChange(client, userId, from, to) {
  const taken = await client.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id != $2', [to, userId])
  if (taken.rowCount) throw new HttpError(409, 'Another OVO account already uses that email.')
  const result = await client.query(
    'UPDATE users SET email = $1, email_verified_at = now() WHERE id = $2 AND lower(email) = $3 RETURNING full_name',
    [to, userId, from],
  )
  return result.rows[0]
}

router.post('/change-email', requireAuth, authLimiter, route(async (request, response) => {
  const values = z.object({ newEmail: emailSchema, currentPassword: z.string().max(128) }).parse(request.body)
  const newEmail = values.newEmail.toLowerCase()
  const oldEmail = request.auth.email.toLowerCase()
  if (newEmail === oldEmail) throw new HttpError(400, 'That’s already your email.')
  if (isPlatformAdmin(oldEmail) || isPlatformAdmin(newEmail)) {
    throw new HttpError(400, 'The OVO owner email is set in the deployment settings (PLATFORM_ADMIN_EMAILS) and can’t be changed here.')
  }
  const user = await pool.query('SELECT password_hash, password_set FROM users WHERE id = $1', [request.auth.userId])
  if (!user.rows[0].password_set) throw new HttpError(400, 'Choose a password first (below), then change your email.')
  if (!(await bcrypt.compare(values.currentPassword, user.rows[0].password_hash))) throw new HttpError(400, 'Your current password is incorrect.')
  const taken = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [newEmail])
  if (taken.rowCount) throw new HttpError(409, 'Another OVO account already uses that email.')

  // With email set up, the new address must confirm it's real before it becomes the sign-in.
  if (emailConfigured()) {
    const token = signEmailChange({ u: request.auth.userId, from: oldEmail, to: newEmail, exp: Date.now() + EMAIL_CHANGE_MS })
    const link = appUrl(request, `/api/auth/confirm-email?token=${encodeURIComponent(token)}`)
    const sent = await sendMail({ to: newEmail, ...verifyEmailChangeEmail({ fullName: request.auth.fullName, newEmail, link }) })
    if (sent.sent) return response.json({ pending: true, email: newEmail })
    console.warn('Email change confirmation not sent:', sent.reason)
  }
  // No email service: the password check is the proof, and the change applies straight away.
  await withTransaction(async (client) => {
    await applyEmailChange(client, request.auth.userId, oldEmail, newEmail)
    await client.query('DELETE FROM user_sessions WHERE user_id = $1 AND id != $2', [request.auth.userId, request.auth.sessionId])
    if (request.auth.organizationId) await logActivity(client, request.auth, 'changed their sign-in email', 'user', request.auth.fullName)
  })
  await sendMail({ to: oldEmail, ...emailChangedEmail({ fullName: request.auth.fullName, newEmail }) })
  return response.json({ changed: true, user: { id: request.auth.userId, fullName: request.auth.fullName, email: newEmail } })
}))

router.get('/confirm-email', authLimiter, route(async (request, response) => {
  const payload = readEmailChange(request.query.token)
  if (!payload) return response.redirect(303, '/?email-change=expired')
  try {
    const user = await withTransaction(async (client) => {
      const updated = await applyEmailChange(client, payload.u, payload.from, payload.to)
      if (updated) await client.query('DELETE FROM user_sessions WHERE user_id = $1', [payload.u])
      return updated
    })
    if (!user) return response.redirect(303, '/?email-change=expired')
    await sendMail({ to: payload.from, ...emailChangedEmail({ fullName: user.full_name, newEmail: payload.to }) })
    return response.redirect(303, '/?email-change=done')
  } catch (error) {
    if (error instanceof HttpError) return response.redirect(303, '/?email-change=taken')
    throw error
  }
}))

async function findInvitation(db, token) {
  const result = await db.query(
    `SELECT i.id, i.email, i.role, i.organization_id, i.invited_by, o.name AS organization_name, inviter.full_name AS inviter_name
     FROM invitations i
     JOIN organizations o ON o.id = i.organization_id
     LEFT JOIN users inviter ON inviter.id = i.invited_by
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
    invitedBy: invitation.inviter_name || null,
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
    const subscription = await getSubscription(client, invitation.organization_id, { lock: true })
    const members = await client.query('SELECT count(*)::int AS count FROM organization_members WHERE organization_id = $1', [invitation.organization_id])
    if (subscription && members.rows[0].count >= subscription.memberLimit) {
      throw new HttpError(409, 'This workspace has reached its member limit. Ask the owner to upgrade the plan.')
    }

    const existing = await client.query(
      `SELECT u.id, EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id) AS has_workspace
       FROM users u WHERE u.email = $1`,
      [invitation.email],
    )
    let userId
    if (existing.rowCount && existing.rows[0].has_workspace) {
      throw new HttpError(409, 'This email already belongs to an OVO workspace. Sign in instead.')
    } else if (existing.rowCount) {
      userId = existing.rows[0].id
      await client.query(
        'UPDATE users SET full_name = $1, password_hash = $2, terms_accepted_at = now(), terms_version = $4 WHERE id = $3',
        [values.fullName, passwordHash, userId, TERMS_VERSION],
      )
    } else {
      const user = await client.query(
        'INSERT INTO users (full_name, email, password_hash, terms_accepted_at, terms_version) VALUES ($1, $2, $3, now(), $4) RETURNING id',
        [values.fullName, invitation.email, passwordHash, TERMS_VERSION],
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

// What the sign-in screen can offer (e.g. emailed password resets).
router.get('/options', (_request, response) => response.json({ emailEnabled: emailConfigured() }))

// Self-service password reset by email. Always answers the same way so it can't reveal who has an account.
router.post('/forgot', authLimiter, route(async (request, response) => {
  const { email } = z.object({ email: emailSchema }).parse(request.body)
  if (!emailConfigured()) throw new HttpError(400, 'Password reset emails aren’t available yet. Ask your workspace owner or admin for a reset link.')
  const user = await pool.query(
    `SELECT u.id, u.full_name FROM users u
     WHERE lower(u.email) = $1 AND EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id)`,
    [email.toLowerCase()],
  )
  if (user.rowCount) {
    const { token, tokenHash } = createToken()
    await pool.query(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 hour\')',
      [user.rows[0].id, tokenHash],
    )
    const sent = await sendMail({ to: email.toLowerCase(), ...passwordResetEmail({ fullName: user.rows[0].full_name, link: appUrl(request, `/?reset=${token}`) }) })
    if (!sent.sent) console.warn('Password reset email not sent:', sent.reason)
  }
  return response.json({ ok: true })
}))

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
    await client.query('UPDATE users SET password_hash = $1, password_set = true WHERE id = $2', [passwordHash, reset.user_id])
    await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id])
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [reset.user_id])
  })
  return response.json({ ok: true })
}))

export default router
