import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import {
  HttpError, MANAGERS, assertInOrg, assertMember, emailSchema, getSubscription, logActivity, notify,
  optionalDate, optionalId, route, validationError, withTransaction,
} from '../lib.js'

const router = express.Router()
router.use(requireAuth)
const managersOnly = requireRole(...MANAGERS)

const clientStatuses = ['Lead', 'Contacted', 'Interested', 'Active', 'Completed', 'Archived']
const projectStatuses = ['Planning', 'In Progress', 'Review', 'Completed', 'On Hold', 'Cancelled']
const taskStatuses = ['To Do', 'In Progress', 'Review', 'Completed']
const priorities = ['Low', 'Medium', 'High', 'Urgent']
const campaignStatuses = ['Planning', 'Active', 'Review', 'Completed', 'Paused']
const eventTypes = ['Meeting', 'Task deadline', 'Project deadline', 'Campaign', 'Client appointment', 'Company event']

const clientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(120).optional(),
  email: z.union([emailSchema, z.literal('')]).optional(),
  industry: z.string().trim().max(120).optional(),
  status: z.enum(clientStatuses).optional(),
})

const projectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).optional(),
  dueDate: optionalDate,
  status: z.enum(projectStatuses).optional(),
  clientId: optionalId,
})

const taskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(priorities).optional(),
  status: z.enum(taskStatuses).optional(),
  dueDate: optionalDate,
  projectId: optionalId,
  assigneeId: optionalId,
})

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  clientId: optionalId,
  campaignType: z.string().trim().max(80).optional(),
  objective: z.string().trim().max(2000).optional(),
  targetAudience: z.string().trim().max(1000).optional(),
  status: z.enum(campaignStatuses).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  budget: z.coerce.number().min(0).max(999999999999).optional(),
  platforms: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  results: z.string().trim().max(3000).optional(),
  leadsGenerated: z.coerce.number().int().min(0).max(100000000).optional(),
  conversions: z.coerce.number().int().min(0).max(100000000).optional(),
  revenue: z.coerce.number().min(0).max(999999999999).optional(),
  notes: z.string().trim().max(5000).optional(),
}).refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
  message: 'Campaign end date must be on or after the start date.',
  path: ['endDate'],
})

const calendarEventSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(3000).optional(),
  eventType: z.enum(eventTypes).optional(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).optional().nullable(),
  projectId: optionalId,
  clientId: optionalId,
}).refine((value) => !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt), {
  message: 'Event end time must be after the start time.',
  path: ['endsAt'],
})

function parse(schema, body, response) {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    validationError(response, parsed.error)
    return null
  }
  return parsed.data
}

// ---------------------------------------------------------------- Dashboard

router.get('/dashboard', route(async (request, response) => {
  const { organizationId, role, userId } = request.auth
  const isManager = MANAGERS.includes(role)
  const [projects, tasks, dueSoon, clients, industries, members, campaigns, storage, activity, weekly] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS count FROM projects
       WHERE organization_id = $1 AND status NOT IN ('Completed', 'Cancelled')`,
      [organizationId],
    ),
    pool.query(
      `SELECT count(*)::int AS count FROM tasks
       WHERE organization_id = $1 AND status != 'Completed' AND ($2 OR assignee_id = $3)`,
      [organizationId, isManager, userId],
    ),
    pool.query(
      `SELECT count(*)::int AS count FROM tasks
       WHERE organization_id = $1 AND status != 'Completed' AND ($2 OR assignee_id = $3)
         AND due_date BETWEEN current_date AND current_date + 7`,
      [organizationId, isManager, userId],
    ),
    pool.query('SELECT count(*)::int AS count FROM clients WHERE organization_id = $1', [organizationId]),
    pool.query(
      `SELECT count(DISTINCT lower(industry))::int AS count FROM clients
       WHERE organization_id = $1 AND industry != ''`,
      [organizationId],
    ),
    pool.query('SELECT count(*)::int AS count FROM organization_members WHERE organization_id = $1', [organizationId]),
    pool.query(
      `SELECT count(*)::int AS count, count(*) FILTER (WHERE status = 'Active')::int AS active
       FROM campaigns WHERE organization_id = $1`,
      [organizationId],
    ),
    pool.query('SELECT COALESCE(sum(size_bytes), 0)::bigint AS used FROM files WHERE organization_id = $1', [organizationId]),
    pool.query(
      `SELECT al.id, al.action, al.object_type, al.object_name AS object, al.created_at, u.full_name AS user_name
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.organization_id = $1 AND ($2 OR al.user_id = $3) AND al.action != 'signed in'
       ORDER BY al.created_at DESC
       LIMIT 8`,
      [organizationId, isManager, userId],
    ),
    pool.query(
      `SELECT to_char(week, 'YYYY-MM-DD') AS week, count(al.id)::int AS count
       FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS week
       LEFT JOIN activity_logs al
         ON al.organization_id = $1 AND date_trunc('week', al.created_at) = week
        AND al.action != 'signed in' AND ($2 OR al.user_id = $3)
       GROUP BY week ORDER BY week`,
      [organizationId, isManager, userId],
    ),
  ])
  const subscription = await getSubscription(pool, organizationId)
  const count = (result) => result.rows[0].count
  return response.json({
    stats: {
      projects: isManager ? count(projects) : null,
      tasks: count(tasks),
      tasksDueThisWeek: count(dueSoon),
      clients: isManager ? count(clients) : null,
      clientIndustries: isManager ? count(industries) : null,
      members: count(members),
      campaigns: isManager ? count(campaigns) : null,
      activeCampaigns: isManager ? campaigns.rows[0].active : null,
      storageUsedBytes: Number(storage.rows[0].used),
      storageLimitBytes: Number(subscription?.storage_limit_bytes || 0),
    },
    weeklyActivity: weekly.rows,
    activity: activity.rows.map((entry) => ({
      id: entry.id,
      user: entry.user_name || 'Former member',
      action: entry.action,
      objectType: entry.object_type,
      object: entry.object,
      time: entry.created_at,
    })),
  })
}))

// ---------------------------------------------------------------- Clients

const clientColumns = `id, name, contact_name AS "contactName", email, status, industry, created_at AS "createdAt"`

router.get('/clients', managersOnly, route(async (request, response) => {
  const result = await pool.query(
    `SELECT c.id, c.name, c.contact_name AS "contactName", c.email, c.status, c.industry, c.created_at AS "createdAt",
            (SELECT count(*)::int FROM projects p WHERE p.client_id = c.id) AS "projectCount"
     FROM clients c WHERE c.organization_id = $1 ORDER BY c.created_at DESC LIMIT 500`,
    [request.auth.organizationId],
  )
  return response.json({ clients: result.rows })
}))

router.post('/clients', managersOnly, route(async (request, response) => {
  const values = parse(clientSchema, request.body, response)
  if (!values) return undefined
  const result = await pool.query(
    `INSERT INTO clients (organization_id, name, contact_name, email, industry, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${clientColumns}`,
    [request.auth.organizationId, values.name, values.contactName || '', values.email || '', values.industry || '', values.status || 'Lead', request.auth.userId],
  )
  await logActivity(pool, request.auth, 'added client', 'client', values.name)
  return response.status(201).json({ client: result.rows[0] })
}))

router.put('/clients/:id', managersOnly, route(async (request, response) => {
  const values = parse(clientSchema, request.body, response)
  if (!values) return undefined
  const result = await pool.query(
    `UPDATE clients SET name = $1, contact_name = $2, email = $3, industry = $4, status = COALESCE($5, status)
     WHERE id = $6 AND organization_id = $7 RETURNING ${clientColumns}`,
    [values.name, values.contactName || '', values.email || '', values.industry || '', values.status || null, request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Client not found in this workspace.' })
  await logActivity(pool, request.auth, 'updated client', 'client', values.name)
  return response.json({ client: result.rows[0] })
}))

router.delete('/clients/:id', managersOnly, route(async (request, response) => {
  const result = await pool.query(
    'DELETE FROM clients WHERE id = $1 AND organization_id = $2 RETURNING name',
    [request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Client not found in this workspace.' })
  await logActivity(pool, request.auth, 'removed client', 'client', result.rows[0].name)
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Projects

const projectSelect = `
  SELECT p.id, p.name, p.description, p.status, p.due_date AS "dueDate", p.created_at AS "createdAt",
         p.client_id AS "clientId", c.name AS "clientName",
         (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id) AS "taskCount",
         (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'Completed') AS "completedTaskCount"
  FROM projects p
  LEFT JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id`

router.get('/projects', managersOnly, route(async (request, response) => {
  const result = await pool.query(
    `${projectSelect} WHERE p.organization_id = $1 ORDER BY p.created_at DESC LIMIT 500`,
    [request.auth.organizationId],
  )
  return response.json({ projects: result.rows })
}))

router.post('/projects', managersOnly, route(async (request, response) => {
  const values = parse(projectSchema, request.body, response)
  if (!values) return undefined
  const project = await withTransaction(async (client) => {
    const subscription = await getSubscription(client, request.auth.organizationId, { lock: true })
    if (!subscription || ['cancelled', 'expired', 'suspended'].includes(subscription.status)) {
      throw new HttpError(403, 'This workspace does not have an active project allowance.')
    }
    if (subscription.project_limit !== null) {
      const existing = await client.query('SELECT count(*)::int AS count FROM projects WHERE organization_id = $1', [request.auth.organizationId])
      if (existing.rows[0].count >= subscription.project_limit) {
        throw new HttpError(409, `The ${subscription.plan_name} plan includes ${subscription.project_limit} projects. Upgrade the plan to add more.`)
      }
    }
    await assertInOrg(client, 'clients', values.clientId, request.auth.organizationId, 'Client')
    const inserted = await client.query(
      `INSERT INTO projects (organization_id, name, description, due_date, status, client_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [request.auth.organizationId, values.name, values.description || '', values.dueDate || null, values.status || 'Planning', values.clientId || null, request.auth.userId],
    )
    await logActivity(client, request.auth, 'created project', 'project', values.name)
    const result = await client.query(`${projectSelect} WHERE p.id = $1`, [inserted.rows[0].id])
    return result.rows[0]
  })
  return response.status(201).json({ project })
}))

router.put('/projects/:id', managersOnly, route(async (request, response) => {
  const values = parse(projectSchema, request.body, response)
  if (!values) return undefined
  await assertInOrg(pool, 'clients', values.clientId, request.auth.organizationId, 'Client')
  const result = await pool.query(
    `UPDATE projects SET name = $1, description = $2, due_date = $3, status = COALESCE($4, status), client_id = $5
     WHERE id = $6 AND organization_id = $7 RETURNING id`,
    [values.name, values.description || '', values.dueDate || null, values.status || null, values.clientId || null, request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Project not found in this workspace.' })
  await logActivity(pool, request.auth, 'updated project', 'project', values.name)
  const project = await pool.query(`${projectSelect} WHERE p.id = $1`, [request.params.id])
  return response.json({ project: project.rows[0] })
}))

router.delete('/projects/:id', managersOnly, route(async (request, response) => {
  const result = await pool.query(
    'DELETE FROM projects WHERE id = $1 AND organization_id = $2 RETURNING name',
    [request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Project not found in this workspace.' })
  await logActivity(pool, request.auth, 'deleted project', 'project', result.rows[0].name)
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Tasks

const taskSelect = `
  SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date AS "dueDate",
         t.project_id AS "projectId", p.name AS "projectName",
         t.assignee_id AS "assigneeId", u.full_name AS "assigneeName",
         t.created_by AS "createdBy", t.created_at AS "createdAt"
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assignee_id
  LEFT JOIN projects p ON p.id = t.project_id`

async function notifyAssignee(db, auth, task, previousAssigneeId) {
  if (task.assigneeId && task.assigneeId !== auth.userId && task.assigneeId !== previousAssigneeId) {
    await notify(db, auth.organizationId, task.assigneeId, {
      title: 'New task assigned to you',
      message: `${auth.fullName} assigned you “${task.title}”.`,
      resourceType: 'task',
      resourceId: task.id,
    })
  }
}

router.get('/tasks', route(async (request, response) => {
  const isManager = MANAGERS.includes(request.auth.role)
  const result = await pool.query(
    `${taskSelect}
     WHERE t.organization_id = $1 AND ($2 OR t.assignee_id = $3)
     ORDER BY (t.status = 'Completed'), t.due_date NULLS LAST, t.created_at DESC LIMIT 500`,
    [request.auth.organizationId, isManager, request.auth.userId],
  )
  return response.json({ tasks: result.rows })
}))

router.post('/tasks', managersOnly, route(async (request, response) => {
  const values = parse(taskSchema, request.body, response)
  if (!values) return undefined
  const task = await withTransaction(async (client) => {
    await assertInOrg(client, 'projects', values.projectId, request.auth.organizationId, 'Project')
    await assertMember(client, values.assigneeId, request.auth.organizationId)
    const inserted = await client.query(
      `INSERT INTO tasks (organization_id, project_id, title, description, priority, status, due_date, assignee_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [request.auth.organizationId, values.projectId || null, values.title, values.description || '', values.priority || 'Medium', values.status || 'To Do', values.dueDate || null, values.assigneeId || null, request.auth.userId],
    )
    await logActivity(client, request.auth, 'created task', 'task', values.title)
    const result = await client.query(`${taskSelect} WHERE t.id = $1`, [inserted.rows[0].id])
    await notifyAssignee(client, request.auth, result.rows[0], null)
    return result.rows[0]
  })
  return response.status(201).json({ task })
}))

router.put('/tasks/:id', managersOnly, route(async (request, response) => {
  const values = parse(taskSchema, request.body, response)
  if (!values) return undefined
  const task = await withTransaction(async (client) => {
    const previous = await client.query(
      'SELECT assignee_id FROM tasks WHERE id = $1 AND organization_id = $2 FOR UPDATE',
      [request.params.id, request.auth.organizationId],
    )
    if (!previous.rowCount) throw new HttpError(404, 'Task not found in this workspace.')
    await assertInOrg(client, 'projects', values.projectId, request.auth.organizationId, 'Project')
    await assertMember(client, values.assigneeId, request.auth.organizationId)
    await client.query(
      `UPDATE tasks SET title = $1, description = $2, priority = $3, status = COALESCE($4, status),
              due_date = $5, project_id = $6, assignee_id = $7
       WHERE id = $8`,
      [values.title, values.description || '', values.priority || 'Medium', values.status || null, values.dueDate || null, values.projectId || null, values.assigneeId || null, request.params.id],
    )
    await logActivity(client, request.auth, 'updated task', 'task', values.title)
    const result = await client.query(`${taskSelect} WHERE t.id = $1`, [request.params.id])
    await notifyAssignee(client, request.auth, result.rows[0], previous.rows[0].assignee_id)
    return result.rows[0]
  })
  return response.json({ task })
}))

// Status changes are open to the assignee as well as managers.
router.patch('/tasks/:id', route(async (request, response) => {
  const values = parse(z.object({ status: z.enum(taskStatuses) }).strict(), request.body, response)
  if (!values) return undefined
  const task = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE tasks SET status = $1
       WHERE id = $2 AND organization_id = $3 AND ($4 OR assignee_id = $5)
       RETURNING id`,
      [values.status, request.params.id, request.auth.organizationId, MANAGERS.includes(request.auth.role), request.auth.userId],
    )
    if (!updated.rowCount) throw new HttpError(404, 'Task not found or you do not have permission to update it.')
    const result = await client.query(`${taskSelect} WHERE t.id = $1`, [request.params.id])
    const row = result.rows[0]
    await logActivity(client, request.auth, `moved task to ${values.status}`, 'task', row.title)
    if (values.status === 'Completed' && row.createdBy && row.createdBy !== request.auth.userId) {
      const creator = await client.query(
        'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2',
        [request.auth.organizationId, row.createdBy],
      )
      if (creator.rowCount) {
        await notify(client, request.auth.organizationId, row.createdBy, {
          title: 'Task completed',
          message: `${request.auth.fullName} completed “${row.title}”.`,
          resourceType: 'task',
          resourceId: row.id,
        })
      }
    }
    return row
  })
  return response.json({ task })
}))

router.delete('/tasks/:id', managersOnly, route(async (request, response) => {
  const result = await pool.query(
    'DELETE FROM tasks WHERE id = $1 AND organization_id = $2 RETURNING title',
    [request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Task not found in this workspace.' })
  await logActivity(pool, request.auth, 'deleted task', 'task', result.rows[0].title)
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Campaigns

const campaignSelect = `
  SELECT cp.id, cp.name, cp.client_id AS "clientId", cl.name AS "clientName",
         cp.campaign_type AS "campaignType", cp.objective, cp.target_audience AS "targetAudience",
         cp.status, cp.start_date AS "startDate", cp.end_date AS "endDate", cp.budget::float AS budget,
         cp.platforms, cp.results, cp.leads_generated AS "leadsGenerated",
         cp.conversions, cp.revenue::float AS revenue, cp.notes, cp.created_at AS "createdAt"
  FROM campaigns cp
  LEFT JOIN clients cl ON cl.id = cp.client_id AND cl.organization_id = cp.organization_id`

function campaignParams(values) {
  return [
    values.clientId || null, values.name, values.campaignType || 'Other', values.objective || '',
    values.targetAudience || '', values.status || 'Planning', values.startDate || null, values.endDate || null,
    values.budget || 0, values.platforms || [], values.results || '', values.leadsGenerated || 0,
    values.conversions || 0, values.revenue || 0, values.notes || '',
  ]
}

router.get('/campaigns', managersOnly, route(async (request, response) => {
  const result = await pool.query(
    `${campaignSelect} WHERE cp.organization_id = $1 ORDER BY cp.created_at DESC LIMIT 500`,
    [request.auth.organizationId],
  )
  return response.json({ campaigns: result.rows })
}))

router.post('/campaigns', managersOnly, route(async (request, response) => {
  const values = parse(campaignSchema, request.body, response)
  if (!values) return undefined
  await assertInOrg(pool, 'clients', values.clientId, request.auth.organizationId, 'Client')
  const inserted = await pool.query(
    `INSERT INTO campaigns (
       client_id, name, campaign_type, objective, target_audience, status, start_date, end_date,
       budget, platforms, results, leads_generated, conversions, revenue, notes, organization_id, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
    [...campaignParams(values), request.auth.organizationId, request.auth.userId],
  )
  await logActivity(pool, request.auth, 'created campaign', 'campaign', values.name)
  const result = await pool.query(`${campaignSelect} WHERE cp.id = $1`, [inserted.rows[0].id])
  return response.status(201).json({ campaign: result.rows[0] })
}))

router.put('/campaigns/:id', managersOnly, route(async (request, response) => {
  const values = parse(campaignSchema, request.body, response)
  if (!values) return undefined
  await assertInOrg(pool, 'clients', values.clientId, request.auth.organizationId, 'Client')
  const updated = await pool.query(
    `UPDATE campaigns SET
       client_id = $1, name = $2, campaign_type = $3, objective = $4, target_audience = $5, status = $6,
       start_date = $7, end_date = $8, budget = $9, platforms = $10, results = $11, leads_generated = $12,
       conversions = $13, revenue = $14, notes = $15, updated_at = now()
     WHERE id = $16 AND organization_id = $17 RETURNING id`,
    [...campaignParams(values), request.params.id, request.auth.organizationId],
  )
  if (!updated.rowCount) return response.status(404).json({ error: 'Campaign not found in this workspace.' })
  await logActivity(pool, request.auth, 'updated campaign', 'campaign', values.name)
  const result = await pool.query(`${campaignSelect} WHERE cp.id = $1`, [request.params.id])
  return response.json({ campaign: result.rows[0] })
}))

router.patch('/campaigns/:id/status', managersOnly, route(async (request, response) => {
  const values = parse(z.object({ status: z.enum(campaignStatuses) }), request.body, response)
  if (!values) return undefined
  const updated = await pool.query(
    `UPDATE campaigns SET status = $1, updated_at = now()
     WHERE id = $2 AND organization_id = $3 RETURNING name`,
    [values.status, request.params.id, request.auth.organizationId],
  )
  if (!updated.rowCount) return response.status(404).json({ error: 'Campaign not found in this workspace.' })
  await logActivity(pool, request.auth, `moved campaign to ${values.status}`, 'campaign', updated.rows[0].name)
  const result = await pool.query(`${campaignSelect} WHERE cp.id = $1`, [request.params.id])
  return response.json({ campaign: result.rows[0] })
}))

router.delete('/campaigns/:id', managersOnly, route(async (request, response) => {
  const result = await pool.query(
    'DELETE FROM campaigns WHERE id = $1 AND organization_id = $2 RETURNING name',
    [request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Campaign not found in this workspace.' })
  await logActivity(pool, request.auth, 'deleted campaign', 'campaign', result.rows[0].name)
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Calendar

const eventSelect = `
  SELECT e.id, e.title, e.description, e.event_type AS "eventType",
         e.starts_at AS "startsAt", e.ends_at AS "endsAt",
         e.project_id AS "projectId", p.name AS "projectName",
         e.client_id AS "clientId", c.name AS "clientName",
         e.created_by AS "createdBy"
  FROM calendar_events e
  LEFT JOIN projects p ON p.id = e.project_id AND p.organization_id = e.organization_id
  LEFT JOIN clients c ON c.id = e.client_id AND c.organization_id = e.organization_id`

const rangeSchema = z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() })

router.get('/calendar', route(async (request, response) => {
  const range = rangeSchema.parse(request.query)
  const result = await pool.query(
    `${eventSelect}
     WHERE e.organization_id = $1
       AND e.starts_at >= COALESCE($2::timestamptz, date_trunc('month', now()) - interval '1 month')
       AND e.starts_at < COALESCE($3::timestamptz, now() + interval '1 year')
     ORDER BY e.starts_at ASC LIMIT 1000`,
    [request.auth.organizationId, range.from || null, range.to || null],
  )
  return response.json({ events: result.rows })
}))

async function validateEventLinks(db, values, organizationId) {
  await assertInOrg(db, 'projects', values.projectId, organizationId, 'Project')
  await assertInOrg(db, 'clients', values.clientId, organizationId, 'Client')
}

router.post('/calendar', managersOnly, route(async (request, response) => {
  const values = parse(calendarEventSchema, request.body, response)
  if (!values) return undefined
  await validateEventLinks(pool, values, request.auth.organizationId)
  const inserted = await pool.query(
    `INSERT INTO calendar_events (organization_id, title, description, event_type, starts_at, ends_at, project_id, client_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [request.auth.organizationId, values.title, values.description || '', values.eventType || 'Meeting', values.startsAt, values.endsAt || null, values.projectId || null, values.clientId || null, request.auth.userId],
  )
  await logActivity(pool, request.auth, 'scheduled', 'calendar event', values.title)
  const result = await pool.query(`${eventSelect} WHERE e.id = $1`, [inserted.rows[0].id])
  return response.status(201).json({ event: result.rows[0] })
}))

router.put('/calendar/:id', managersOnly, route(async (request, response) => {
  const values = parse(calendarEventSchema, request.body, response)
  if (!values) return undefined
  await validateEventLinks(pool, values, request.auth.organizationId)
  const updated = await pool.query(
    `UPDATE calendar_events SET title = $1, description = $2, event_type = $3, starts_at = $4, ends_at = $5, project_id = $6, client_id = $7
     WHERE id = $8 AND organization_id = $9 RETURNING id`,
    [values.title, values.description || '', values.eventType || 'Meeting', values.startsAt, values.endsAt || null, values.projectId || null, values.clientId || null, request.params.id, request.auth.organizationId],
  )
  if (!updated.rowCount) return response.status(404).json({ error: 'Event not found in this workspace.' })
  await logActivity(pool, request.auth, 'rescheduled', 'calendar event', values.title)
  const result = await pool.query(`${eventSelect} WHERE e.id = $1`, [request.params.id])
  return response.json({ event: result.rows[0] })
}))

router.delete('/calendar/:id', managersOnly, route(async (request, response) => {
  const result = await pool.query(
    'DELETE FROM calendar_events WHERE id = $1 AND organization_id = $2 RETURNING title',
    [request.params.id, request.auth.organizationId],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Event not found in this workspace.' })
  await logActivity(pool, request.auth, 'cancelled', 'calendar event', result.rows[0].title)
  return response.status(204).end()
}))

// ---------------------------------------------------------------- Notifications

router.get('/notifications', route(async (request, response) => {
  const result = await pool.query(
    `SELECT id, title, message, resource_type AS "resourceType", resource_id AS "resourceId",
            read_at AS "readAt", created_at AS "createdAt"
     FROM notifications WHERE organization_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT 100`,
    [request.auth.organizationId, request.auth.userId],
  )
  return response.json({ notifications: result.rows })
}))

router.patch('/notifications/:id/read', route(async (request, response) => {
  const result = await pool.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
     WHERE id = $1 AND organization_id = $2 AND user_id = $3
     RETURNING id, read_at AS "readAt"`,
    [request.params.id, request.auth.organizationId, request.auth.userId],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Notification not found.' })
  return response.json({ notification: result.rows[0] })
}))

router.post('/notifications/read-all', route(async (request, response) => {
  await pool.query(
    `UPDATE notifications SET read_at = now()
     WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [request.auth.organizationId, request.auth.userId],
  )
  return response.status(204).end()
}))

export default router
