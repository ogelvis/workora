import 'dotenv/config'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { z } from 'zod'
import { pool } from './db.js'
import { createSession, destroySession, requireAuth, requireRole } from './auth.js'

if (
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.length < 32 ||
  process.env.SESSION_SECRET.startsWith('REPLACE_WITH_')
) {
  throw new Error('SESSION_SECRET must be configured with at least 32 characters.')
}

const app = express()
const port = Number(process.env.PORT || 3001)
const isProduction = process.env.NODE_ENV === 'production'
const rootDir = path.dirname(fileURLToPath(import.meta.url))
const emailSchema = z.string().trim().email().max(254)
const passwordSchema = z.string().min(12).max(128)

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
app.use(cookieParser())
app.use(express.json({ limit: '32kb' }))
app.use(express.urlencoded({ extended: false, limit: '16kb' }))
app.use((request, response, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.get('origin')) {
    const expectedOrigin = `${request.protocol}://${request.get('host')}`
    if (request.get('origin') !== expectedOrigin) {
      return response.status(403).json({ error: 'Request origin is not allowed.' })
    }
  }
  return next()
})

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

const clientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(120).optional(),
  email: z.union([emailSchema, z.literal('')]).optional(),
  industry: z.string().trim().max(120).optional(),
})

const projectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).optional(),
  dueDate: z.union([z.iso.date(), z.literal('')]).optional(),
})

const taskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(),
  dueDate: z.union([z.iso.date(), z.literal('')]).optional(),
  projectId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
})

function validationError(response, error) {
  return response.status(400).json({
    error: error.issues?.[0]?.message || 'Please check the submitted information.',
  })
}

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1')
    return response.json({ status: 'ok', database: 'connected' })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/auth/register', authLimiter, async (request, response, next) => {
  const parsed = registerSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)

  const values = parsed.data
  const email = values.email.toLowerCase()
  const businessEmail = values.businessEmail.toLowerCase()
  const passwordHash = await bcrypt.hash(values.password, 12)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email])
    if (existingUser.rowCount) {
      await client.query('ROLLBACK')
      return response.status(409).json({ error: 'An account with this email already exists.' })
    }
    const organization = await client.query(
      'INSERT INTO organizations (name, business_email) VALUES ($1, $2) RETURNING id, name',
      [values.organizationName, businessEmail],
    )
    const user = await client.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, email',
      [values.fullName, email, passwordHash],
    )
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [organization.rows[0].id, user.rows[0].id],
    )
    const plan = await client.query("SELECT id FROM subscription_plans WHERE name = 'Starter'")
    await client.query(
      `INSERT INTO subscriptions (organization_id, plan_id, status)
       VALUES ($1, $2, 'trial')`,
      [organization.rows[0].id, plan.rows[0].id],
    )
    await client.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, 'created workspace', 'organization', $3)`,
      [organization.rows[0].id, user.rows[0].id, organization.rows[0].name],
    )
    await client.query('COMMIT')
    await createSession(user.rows[0].id, response)
    return response.status(201).json({
      user: { id: user.rows[0].id, fullName: user.rows[0].full_name, email: user.rows[0].email },
      organization: { id: organization.rows[0].id, name: organization.rows[0].name },
      role: 'owner',
    })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('Could not roll back workspace registration:', rollbackError)
    }
    if (error.code === '23505') {
      return response.status(409).json({ error: 'An account with this email already exists.' })
    }
    return next(error)
  } finally {
    client.release()
  }
})

app.post('/api/auth/login', authLimiter, async (request, response, next) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  try {
    const email = parsed.data.email.toLowerCase()
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.password_hash, om.organization_id,
              o.name AS organization_name, om.role
       FROM users u
       JOIN organization_members om ON om.user_id = u.id
       JOIN organizations o ON o.id = om.organization_id
       WHERE u.email = $1
       ORDER BY om.created_at ASC
       LIMIT 1`,
      [email],
    )
    const account = result.rows[0]
    if (!account || !(await bcrypt.compare(parsed.data.password, account.password_hash))) {
      return response.status(401).json({ error: 'Email or password is incorrect.' })
    }
    await createSession(account.id, response)
    await pool.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, 'signed in', 'user', $3)`,
      [account.organization_id, account.id, account.full_name],
    )
    return response.json({
      user: { id: account.id, fullName: account.full_name, email: account.email },
      organization: { id: account.organization_id, name: account.organization_name },
      role: account.role,
    })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/auth/logout', async (request, response, next) => {
  try {
    await destroySession(request, response)
    return response.status(204).end()
  } catch (error) {
    return next(error)
  }
})

app.get('/api/auth/me', requireAuth, (request, response) => {
  const { userId, fullName, email, organizationId, organizationName, role } = request.auth
  return response.json({
    user: { id: userId, fullName, email },
    organization: { id: organizationId, name: organizationName },
    role,
  })
})

app.get('/api/dashboard', requireAuth, async (request, response, next) => {
  const organizationId = request.auth.organizationId
  const { role, userId } = request.auth
  try {
    const [projects, tasks, clients, users, storage, activity] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS count FROM projects
         WHERE organization_id = $1 AND status NOT IN ('Completed', 'Cancelled') AND $2 != 'staff'`,
        [organizationId, role],
      ),
      pool.query(
        `SELECT count(*)::int AS count FROM tasks
         WHERE organization_id = $1 AND status != 'Completed'
           AND ($2 IN ('owner', 'admin', 'manager') OR assignee_id = $3)`,
        [organizationId, role, userId],
      ),
      pool.query(
        `SELECT count(*)::int AS count FROM clients
         WHERE organization_id = $1 AND $2 IN ('owner', 'admin', 'manager')`,
        [organizationId, role],
      ),
      pool.query(
        `SELECT count(*)::int AS count FROM organization_members
         WHERE organization_id = $1 AND $2 IN ('owner', 'admin', 'manager')`,
        [organizationId, role],
      ),
      pool.query(
        `SELECT 0::bigint AS used, COALESCE(sp.storage_limit_bytes, 0)::bigint AS storage_limit_bytes
         FROM subscriptions s
         JOIN subscription_plans sp ON sp.id = s.plan_id
         WHERE s.organization_id = $1`,
        [organizationId],
      ),
      pool.query(
        `SELECT al.action, al.object_name AS object, al.created_at, u.full_name AS user_name
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.organization_id = $1 AND ($2 != 'staff' OR al.user_id = $3)
         ORDER BY al.created_at DESC
         LIMIT 8`,
        [organizationId, role, userId],
      ),
    ])
    const count = (result) => result.rows[0].count
    const usage = storage.rows[0]
    return response.json({
      stats: {
        projects: count(projects),
        tasks: count(tasks),
        clients: count(clients),
        members: count(users),
        campaigns: null,
        storageUsedBytes: Number(usage.used),
        storageLimitBytes: Number(usage.storage_limit_bytes),
      },
      activity: activity.rows.map((entry) => ({
        user: entry.user_name || 'Former member',
        action: entry.action,
        object: entry.object,
        time: entry.created_at,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/clients', requireAuth, requireRole('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, contact_name AS "contactName", email, status, industry, created_at AS "createdAt"
       FROM clients WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [request.auth.organizationId],
    )
    return response.json({ clients: result.rows })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/clients', requireAuth, requireRole('owner', 'admin', 'manager'), async (request, response, next) => {
  const parsed = clientSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  try {
    const values = parsed.data
    const result = await pool.query(
      `INSERT INTO clients (organization_id, name, contact_name, email, industry, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, contact_name AS "contactName", email, status, industry, created_at AS "createdAt"`,
      [request.auth.organizationId, values.name, values.contactName || '', values.email || '', values.industry || '', request.auth.userId],
    )
    await pool.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, 'created client', 'client', $3)`,
      [request.auth.organizationId, request.auth.userId, values.name],
    )
    return response.status(201).json({ client: result.rows[0] })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/projects', requireAuth, requireRole('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, status, due_date AS "dueDate", created_at AS "createdAt"
       FROM projects WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [request.auth.organizationId],
    )
    return response.json({ projects: result.rows })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/projects', requireAuth, requireRole('owner', 'admin', 'manager'), async (request, response, next) => {
  const parsed = projectSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const client = await pool.connect()
  try {
    const values = parsed.data
    await client.query('BEGIN')
    const subscription = await client.query(
      `SELECT s.status, sp.project_limit
       FROM subscriptions s
       JOIN subscription_plans sp ON sp.id = s.plan_id
       WHERE s.organization_id = $1
       FOR UPDATE OF s`,
      [request.auth.organizationId],
    )
    if (!subscription.rowCount || ['cancelled', 'expired', 'suspended'].includes(subscription.rows[0].status)) {
      await client.query('ROLLBACK')
      return response.status(403).json({ error: 'This workspace does not have an active project allowance.' })
    }
    const projectLimit = subscription.rows[0].project_limit
    if (projectLimit !== null) {
      const projectCount = await client.query(
        'SELECT count(*)::int AS count FROM projects WHERE organization_id = $1',
        [request.auth.organizationId],
      )
      if (projectCount.rows[0].count >= projectLimit) {
        await client.query('ROLLBACK')
        return response.status(409).json({ error: 'This workspace has reached its project limit. Upgrade the subscription to add more projects.' })
      }
    }
    const result = await client.query(
      `INSERT INTO projects (organization_id, name, description, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, status, due_date AS "dueDate", created_at AS "createdAt"`,
      [request.auth.organizationId, values.name, values.description || '', values.dueDate || null, request.auth.userId],
    )
    await client.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, 'created project', 'project', $3)`,
      [request.auth.organizationId, request.auth.userId, values.name],
    )
    await client.query('COMMIT')
    return response.status(201).json({ project: result.rows[0] })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('Could not roll back project creation:', rollbackError)
    }
    return next(error)
  } finally {
    client.release()
  }
})

app.get('/api/tasks', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date AS "dueDate",
              t.project_id AS "projectId", t.assignee_id AS "assigneeId", u.full_name AS "assigneeName"
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.organization_id = $1 AND ($2 IN ('owner', 'admin', 'manager') OR t.assignee_id = $3)
       ORDER BY t.created_at DESC LIMIT 100`,
      [request.auth.organizationId, request.auth.role, request.auth.userId],
    )
    return response.json({ tasks: result.rows })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/tasks', requireAuth, requireRole('owner', 'admin', 'manager'), async (request, response, next) => {
  const parsed = taskSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const values = parsed.data
  try {
    if (values.projectId) {
      const project = await pool.query(
        'SELECT id FROM projects WHERE id = $1 AND organization_id = $2',
        [values.projectId, request.auth.organizationId],
      )
      if (!project.rowCount) return response.status(404).json({ error: 'Project not found in this workspace.' })
    }
    if (values.assigneeId) {
      const member = await pool.query(
        'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2',
        [request.auth.organizationId, values.assigneeId],
      )
      if (!member.rowCount) return response.status(404).json({ error: 'Assignee not found in this workspace.' })
    }
    const result = await pool.query(
      `INSERT INTO tasks (organization_id, project_id, title, description, priority, due_date, assignee_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, description, status, priority, due_date AS "dueDate",
                 project_id AS "projectId", assignee_id AS "assigneeId"`,
      [request.auth.organizationId, values.projectId || null, values.title, values.description || '', values.priority || 'Medium', values.dueDate || null, values.assigneeId || null, request.auth.userId],
    )
    await pool.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, 'created task', 'task', $3)`,
      [request.auth.organizationId, request.auth.userId, values.title],
    )
    return response.status(201).json({ task: result.rows[0] })
  } catch (error) {
    return next(error)
  }
})

const distDir = path.resolve(rootDir, '..', 'dist')
if (isProduction && existsSync(distDir)) {
  app.use(express.static(distDir, { index: false }))
  app.get('*path', (request, response, next) => {
    if (request.path.startsWith('/api/')) return next()
    return response.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((error, _request, response, _next) => {
  console.error('Request failed:', error)
  if (error instanceof SyntaxError && 'body' in error) {
    return response.status(400).json({ error: 'Request body must contain valid JSON.' })
  }
  return response.status(500).json({ error: 'Something went wrong. Please try again.' })
})

const server = app.listen(port, () => {
  console.log(`Workora API listening on port ${port}`)
})

async function shutdown() {
  server.close()
  await pool.end()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
