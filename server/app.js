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

const taskUpdateSchema = z.object({
  status: z.enum(['To Do', 'In Progress', 'Review', 'Completed']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  clientId: z.uuid().optional().nullable(),
  campaignType: z.string().trim().min(1).max(80).optional(),
  objective: z.string().trim().max(2000).optional(),
  targetAudience: z.string().trim().max(1000).optional(),
  status: z.enum(['Planning', 'Active', 'Review', 'Completed', 'Paused']).optional(),
  startDate: z.union([z.iso.date(), z.literal('')]).optional(),
  endDate: z.union([z.iso.date(), z.literal('')]).optional(),
  budget: z.coerce.number().min(0).max(999999999999).optional(),
  platforms: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  results: z.string().trim().max(3000).optional(),
  leadsGenerated: z.number().int().min(0).max(100000000).optional(),
  conversions: z.number().int().min(0).max(100000000).optional(),
  revenue: z.coerce.number().min(0).max(999999999999).optional(),
  notes: z.string().trim().max(5000).optional(),
}).refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
  message: 'Campaign end date must be on or after the start date.',
  path: ['endDate'],
})

const calendarEventSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(3000).optional(),
  eventType: z.enum(['Meeting', 'Task deadline', 'Project deadline', 'Campaign', 'Client appointment', 'Company event']).optional(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).optional().nullable(),
  projectId: z.uuid().optional().nullable(),
  clientId: z.uuid().optional().nullable(),
}).refine((value) => !value.endsAt || value.endsAt > value.startsAt, {
  message: 'Event end time must be after the start time.',
  path: ['endsAt'],
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
    const [projects, tasks, clients, users, campaigns, storage, activity] = await Promise.all([
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
        `SELECT CASE WHEN $2 IN ('owner', 'admin', 'manager')
         THEN count(*)::int ELSE NULL END AS count
         FROM campaigns WHERE organization_id = $1`,
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
        campaigns: campaigns.rows[0].count,
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
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
      `INSERT INTO tasks (organization_id, project_id, title, description, priority, due_date, assignee_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, description, status, priority, due_date AS "dueDate",
                 project_id AS "projectId", assignee_id AS "assigneeId"`,
      [request.auth.organizationId, values.projectId || null, values.title, values.description || '', values.priority || 'Medium', values.dueDate || null, values.assigneeId || null, request.auth.userId],
      )
      await client.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, 'created task', 'task', $3)`,
      [request.auth.organizationId, request.auth.userId, values.title],
      )
      if (values.assigneeId) {
        await client.query(
          `INSERT INTO notifications (organization_id, user_id, title, message, resource_type, resource_id)
           VALUES ($1, $2, 'New task assigned', $3, 'task', $4)`,
          [request.auth.organizationId, values.assigneeId, values.title, result.rows[0].id],
        )
      }
      await client.query('COMMIT')
      return response.status(201).json({ task: result.rows[0] })
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        console.error('Could not roll back task creation:', rollbackError)
      }
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    return next(error)
  }
})

app.patch('/api/tasks/:taskId', requireAuth, async (request, response, next) => {
  const parsed = taskUpdateSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const { status } = parsed.data
  try {
    const result = await pool.query(
      `UPDATE tasks
       SET status = $1
       WHERE id = $2 AND organization_id = $3
         AND ($4 IN ('owner', 'admin', 'manager') OR assignee_id = $5)
       RETURNING id, title, description, status, priority, due_date AS "dueDate",
                 project_id AS "projectId", assignee_id AS "assigneeId"`,
      [status, request.params.taskId, request.auth.organizationId, request.auth.role, request.auth.userId],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Task not found or you do not have permission to update it.' })
    await pool.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, $3, 'task', $4)`,
      [request.auth.organizationId, request.auth.userId, `changed task status to ${status}`, result.rows[0].title],
    )
    return response.json({ task: result.rows[0] })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/campaigns', requireAuth, requireRole('owner', 'admin', 'manager'), async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT cp.id, cp.name, cp.client_id AS "clientId", cl.name AS "clientName",
              cp.campaign_type AS "campaignType", cp.objective, cp.target_audience AS "targetAudience",
              cp.status, cp.start_date AS "startDate", cp.end_date AS "endDate", cp.budget,
              cp.platforms, cp.results, cp.leads_generated AS "leadsGenerated",
              cp.conversions, cp.revenue, cp.notes, cp.created_at AS "createdAt"
       FROM campaigns cp
       LEFT JOIN clients cl ON cl.id = cp.client_id AND cl.organization_id = cp.organization_id
       WHERE cp.organization_id = $1
       ORDER BY cp.created_at DESC
       LIMIT 100`,
      [request.auth.organizationId],
    )
    return response.json({ campaigns: result.rows })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/campaigns', requireAuth, requireRole('owner', 'admin', 'manager'), async (request, response, next) => {
  const parsed = campaignSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const values = parsed.data
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (values.clientId) {
      const clientResult = await client.query(
        'SELECT id FROM clients WHERE id = $1 AND organization_id = $2',
        [values.clientId, request.auth.organizationId],
      )
      if (!clientResult.rowCount) {
        await client.query('ROLLBACK')
        return response.status(404).json({ error: 'Client not found in this workspace.' })
      }
    }
    const result = await client.query(
      `INSERT INTO campaigns (
         organization_id, client_id, name, campaign_type, objective, target_audience,
         status, start_date, end_date, budget, platforms, results,
         leads_generated, conversions, revenue, notes, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id, name, client_id AS "clientId", campaign_type AS "campaignType",
                 objective, target_audience AS "targetAudience", status,
                 start_date AS "startDate", end_date AS "endDate", budget, platforms,
                 results, leads_generated AS "leadsGenerated", conversions, revenue, notes,
                 created_at AS "createdAt"`,
      [
        request.auth.organizationId, values.clientId || null, values.name, values.campaignType || 'Other',
        values.objective || '', values.targetAudience || '', values.status || 'Planning',
        values.startDate || null, values.endDate || null, values.budget || 0, values.platforms || [],
        values.results || '', values.leadsGenerated || 0, values.conversions || 0,
        values.revenue || 0, values.notes || '', request.auth.userId,
      ],
    )
    await client.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, 'created campaign', 'campaign', $3)`,
      [request.auth.organizationId, request.auth.userId, values.name],
    )
    await client.query('COMMIT')
    return response.status(201).json({ campaign: result.rows[0] })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('Could not roll back campaign creation:', rollbackError)
    }
    return next(error)
  } finally {
    client.release()
  }
})

app.patch('/api/campaigns/:campaignId/status', requireAuth, requireRole('owner', 'admin', 'manager'), async (request, response, next) => {
  const parsed = z.object({ status: z.enum(['Planning', 'Active', 'Review', 'Completed', 'Paused']) }).safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  try {
    const result = await pool.query(
      `UPDATE campaigns SET status = $1, updated_at = now()
       WHERE id = $2 AND organization_id = $3
       RETURNING id, name, status`,
      [parsed.data.status, request.params.campaignId, request.auth.organizationId],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Campaign not found in this workspace.' })
    await pool.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, $3, 'campaign', $4)`,
      [request.auth.organizationId, request.auth.userId, `changed campaign status to ${parsed.data.status}`, result.rows[0].name],
    )
    return response.json({ campaign: result.rows[0] })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/calendar', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.title, e.description, e.event_type AS "eventType",
              e.starts_at AS "startsAt", e.ends_at AS "endsAt",
              e.project_id AS "projectId", p.name AS "projectName",
              e.client_id AS "clientId", c.name AS "clientName",
              e.created_by AS "createdBy"
       FROM calendar_events e
       LEFT JOIN projects p ON p.id = e.project_id AND p.organization_id = e.organization_id
       LEFT JOIN clients c ON c.id = e.client_id AND c.organization_id = e.organization_id
       WHERE e.organization_id = $1
         AND e.starts_at >= now() - interval '30 days'
       ORDER BY e.starts_at ASC
       LIMIT 200`,
      [request.auth.organizationId],
    )
    return response.json({ events: result.rows })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/calendar', requireAuth, requireRole('owner', 'admin', 'manager'), async (request, response, next) => {
  const parsed = calendarEventSchema.safeParse(request.body)
  if (!parsed.success) return validationError(response, parsed.error)
  const values = parsed.data
  try {
    if (values.projectId) {
      const project = await pool.query(
        'SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2',
        [values.projectId, request.auth.organizationId],
      )
      if (!project.rowCount) return response.status(404).json({ error: 'Project not found in this workspace.' })
    }
    if (values.clientId) {
      const client = await pool.query(
        'SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2',
        [values.clientId, request.auth.organizationId],
      )
      if (!client.rowCount) return response.status(404).json({ error: 'Client not found in this workspace.' })
    }
    const result = await pool.query(
      `INSERT INTO calendar_events (
         organization_id, title, description, event_type, starts_at, ends_at,
         project_id, client_id, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, description, event_type AS "eventType",
                 starts_at AS "startsAt", ends_at AS "endsAt",
                 project_id AS "projectId", client_id AS "clientId"`,
      [
        request.auth.organizationId, values.title, values.description || '', values.eventType || 'Meeting',
        values.startsAt, values.endsAt || null, values.projectId || null, values.clientId || null,
        request.auth.userId,
      ],
    )
    await pool.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, object_type, object_name)
       VALUES ($1, $2, 'scheduled event', 'calendar event', $3)`,
      [request.auth.organizationId, request.auth.userId, values.title],
    )
    return response.status(201).json({ event: result.rows[0] })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/notifications', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, message, resource_type AS "resourceType", resource_id AS "resourceId",
              read_at AS "readAt", created_at AS "createdAt"
       FROM notifications WHERE organization_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 100`,
      [request.auth.organizationId, request.auth.userId],
    )
    return response.json({ notifications: result.rows })
  } catch (error) {
    return next(error)
  }
})

app.patch('/api/notifications/:notificationId/read', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND organization_id = $2 AND user_id = $3
       RETURNING id, read_at AS "readAt"`,
      [request.params.notificationId, request.auth.organizationId, request.auth.userId],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Notification not found.' })
    return response.json({ notification: result.rows[0] })
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

export default app
