import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { runAutomations } from '../automation.js'
import { requireAuth } from '../auth.js'
import { HttpError, MANAGERS, logActivity, notify, route, withTransaction } from '../lib.js'

// Progress tracking: daily updates on tasks, the owner's daily view, and weekly reports.
const router = express.Router()
router.use(requireAuth)

const isManager = (auth) => MANAGERS.includes(auth.role)

async function findTask(db, auth, id, { lock = false } = {}) {
  z.uuid().parse(id)
  const result = await db.query(
    `SELECT id, title, status, progress, assignee_id, created_by FROM tasks WHERE id = $1 AND organization_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [id, auth.organizationId],
  )
  const task = result.rows[0]
  // Staff only see their own tasks, so anything else reads as "not found".
  if (!task || (!isManager(auth) && task.assignee_id !== auth.userId)) throw new HttpError(404, 'Task not found.')
  return task
}

const updateColumns = `tu.id, tu.progress, tu.note, tu.created_at AS "createdAt", tu.user_id AS "userId", u.full_name AS "userName"`

// ---------------------------------------------------------------- Daily task updates
router.get('/tasks/:id/updates', route(async (request, response) => {
  const task = await findTask(pool, request.auth, request.params.id)
  const result = await pool.query(
    `SELECT ${updateColumns} FROM task_updates tu LEFT JOIN users u ON u.id = tu.user_id
     WHERE tu.task_id = $1 ORDER BY tu.created_at DESC LIMIT 100`,
    [task.id],
  )
  return response.json({ updates: result.rows })
}))

router.post('/tasks/:id/updates', route(async (request, response) => {
  const values = z.object({
    progress: z.number().int().min(0).max(100),
    note: z.string().trim().max(2000).optional().default(''),
  }).parse(request.body)
  if (!values.note && values.progress === undefined) throw new HttpError(400, 'Add a note or a progress level.')
  let completedNow = false
  const result = await withTransaction(async (client) => {
    const task = await findTask(client, request.auth, request.params.id, { lock: true })
    // Progress moves the task along: started work is In Progress, 100% is Completed.
    const status = values.progress === 100 ? 'Completed' : task.status === 'To Do' && values.progress > 0 ? 'In Progress' : task.status === 'Completed' ? 'In Progress' : task.status
    completedNow = task.status !== 'Completed' && status === 'Completed'
    await client.query('UPDATE tasks SET progress = $1, status = $2 WHERE id = $3', [values.progress, status, task.id])
    const inserted = await client.query(
      `INSERT INTO task_updates (organization_id, task_id, user_id, progress, note) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [request.auth.organizationId, task.id, request.auth.userId, values.progress, values.note],
    )
    await logActivity(client, request.auth, completedNow ? 'moved task to Completed' : `posted a ${values.progress}% update on`, 'task', task.title)
    // Whoever assigned the task hears about it.
    if (task.created_by && task.created_by !== request.auth.userId) {
      const creator = await client.query('SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2', [request.auth.organizationId, task.created_by])
      if (creator.rowCount) {
        await notify(client, request.auth.organizationId, task.created_by, {
          title: completedNow ? 'Task completed' : `Update on “${task.title}” — ${values.progress}%`,
          message: `${request.auth.fullName}: ${values.note || (completedNow ? `completed “${task.title}”.` : 'updated the progress.')}`.slice(0, 280),
          resourceType: 'task',
          resourceId: task.id,
          link: '#/reports',
        })
      }
    }
    const update = await client.query(`SELECT ${updateColumns} FROM task_updates tu LEFT JOIN users u ON u.id = tu.user_id WHERE tu.id = $1`, [inserted.rows[0].id])
    return { update: update.rows[0], task: { id: task.id, title: task.title, status, progress: values.progress, assigneeId: task.assignee_id } }
  })
  if (completedNow) await runAutomations({ organizationId: request.auth.organizationId, actorId: request.auth.userId, type: 'task_completed', task: result.task })
  return response.status(201).json(result)
}))

// ---------------------------------------------------------------- Owner's daily view
// The browser sends the start and end of "today" in its own time zone.
router.get('/reports/daily', route(async (request, response) => {
  if (!isManager(request.auth)) throw new HttpError(403, 'Only owners, admins and managers can see team reports.')
  const range = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).parse(request.query)
  const [updates, people] = await Promise.all([
    pool.query(
      `SELECT ${updateColumns}, t.id AS "taskId", t.title AS "taskTitle", t.status AS "taskStatus", p.name AS "projectName"
       FROM task_updates tu
       JOIN tasks t ON t.id = tu.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = tu.user_id
       WHERE tu.organization_id = $1 AND tu.created_at >= $2 AND tu.created_at < $3
       ORDER BY tu.created_at DESC`,
      [request.auth.organizationId, range.from, range.to],
    ),
    pool.query(
      `SELECT u.id, u.full_name AS "fullName", om.role,
              (SELECT count(*)::int FROM tasks t WHERE t.organization_id = om.organization_id AND t.assignee_id = u.id AND t.status <> 'Completed') AS "openTasks",
              (SELECT COALESCE(round(avg(t.progress))::int, 0) FROM tasks t WHERE t.organization_id = om.organization_id AND t.assignee_id = u.id AND t.status <> 'Completed') AS "averageProgress",
              (SELECT count(*)::int FROM tasks t WHERE t.organization_id = om.organization_id AND t.assignee_id = u.id AND t.status <> 'Completed' AND t.due_date < CURRENT_DATE) AS "overdue",
              (SELECT max(tu.created_at) FROM task_updates tu WHERE tu.user_id = u.id AND tu.organization_id = om.organization_id) AS "lastUpdateAt"
       FROM organization_members om JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1
       ORDER BY u.full_name`,
      [request.auth.organizationId],
    ),
  ])
  return response.json({ updates: updates.rows, people: people.rows })
}))

// ---------------------------------------------------------------- Weekly reports
const weekSchema = z.iso.date()
const reportColumns = `r.id, r.user_id AS "userId", u.full_name AS "userName", to_char(r.week_start, 'YYYY-MM-DD') AS "weekStart",
  r.done, r.pending, r.delays, r.remaining, r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
  r.updated_at > r.submitted_at + interval '1 minute' AS edited`

// Weeks start on Monday, whatever day the browser sends.
const mondayOf = (date) => `date_trunc('week', ${date}::date)::date`

router.get('/reports/weekly/mine', route(async (request, response) => {
  const week = weekSchema.parse(request.query.week)
  const [report, completed, pending, history] = await Promise.all([
    pool.query(
      `SELECT ${reportColumns} FROM weekly_reports r JOIN users u ON u.id = r.user_id
       WHERE r.organization_id = $1 AND r.user_id = $2 AND r.week_start = ${mondayOf('$3')}`,
      [request.auth.organizationId, request.auth.userId, week],
    ),
    // Suggestions to start from: what this person finished and what's still open.
    pool.query(
      `SELECT DISTINCT object_name AS title FROM activity_logs
       WHERE organization_id = $1 AND user_id = $2 AND action = 'moved task to Completed' AND object_type = 'task'
         AND created_at >= ${mondayOf('$3')} AND created_at < ${mondayOf('$3')} + 7`,
      [request.auth.organizationId, request.auth.userId, week],
    ),
    pool.query(
      `SELECT title, progress, due_date < CURRENT_DATE AS overdue FROM tasks
       WHERE organization_id = $1 AND assignee_id = $2 AND status <> 'Completed' ORDER BY due_date NULLS LAST LIMIT 30`,
      [request.auth.organizationId, request.auth.userId],
    ),
    pool.query(
      `SELECT ${reportColumns} FROM weekly_reports r JOIN users u ON u.id = r.user_id
       WHERE r.organization_id = $1 AND r.user_id = $2 ORDER BY r.week_start DESC LIMIT 12`,
      [request.auth.organizationId, request.auth.userId],
    ),
  ])
  return response.json({
    report: report.rows[0] || null,
    suggestions: { done: completed.rows.map((row) => row.title), pending: pending.rows },
    history: history.rows,
  })
}))

router.put('/reports/weekly', route(async (request, response) => {
  const values = z.object({
    week: weekSchema,
    done: z.string().trim().max(5000).optional().default(''),
    pending: z.string().trim().max(5000).optional().default(''),
    delays: z.string().trim().max(5000).optional().default(''),
    remaining: z.string().trim().max(5000).optional().default(''),
  }).parse(request.body)
  if (!values.done && !values.pending && !values.remaining) throw new HttpError(400, 'Tell us at least what you finished, what’s pending or what’s remaining.')
  const report = await withTransaction(async (client) => {
    const saved = await client.query(
      `INSERT INTO weekly_reports (organization_id, user_id, week_start, done, pending, delays, remaining)
       VALUES ($1, $2, ${mondayOf('$3')}, $4, $5, $6, $7)
       ON CONFLICT (organization_id, user_id, week_start)
       DO UPDATE SET done = EXCLUDED.done, pending = EXCLUDED.pending, delays = EXCLUDED.delays, remaining = EXCLUDED.remaining, updated_at = now()
       RETURNING id, (xmax = 0) AS created`,
      [request.auth.organizationId, request.auth.userId, values.week, values.done, values.pending, values.delays, values.remaining],
    )
    const { id, created } = saved.rows[0]
    await logActivity(client, request.auth, created ? 'submitted a weekly report' : 'edited a weekly report', 'report', request.auth.fullName)
    // Managers hear about new reports (not every edit).
    if (created) {
      const managers = await client.query(
        "SELECT user_id FROM organization_members WHERE organization_id = $1 AND role IN ('owner', 'admin', 'manager') AND user_id <> $2",
        [request.auth.organizationId, request.auth.userId],
      )
      for (const manager of managers.rows) {
        await notify(client, request.auth.organizationId, manager.user_id, {
          title: `${request.auth.fullName} submitted a weekly report`,
          message: values.delays ? `Delays: ${values.delays}`.slice(0, 280) : (values.done || values.remaining).slice(0, 280),
          resourceType: 'report',
          link: '#/reports?tab=weekly',
        })
      }
    }
    const result = await client.query(`SELECT ${reportColumns} FROM weekly_reports r JOIN users u ON u.id = r.user_id WHERE r.id = $1`, [id])
    return result.rows[0]
  })
  return response.json({ report })
}))

// Owners and managers: everyone's report for a week, and who hasn't sent one yet.
router.get('/reports/weekly', route(async (request, response) => {
  if (!isManager(request.auth)) throw new HttpError(403, 'Only owners, admins and managers can see team reports.')
  const week = weekSchema.parse(request.query.week)
  const [reports, members] = await Promise.all([
    pool.query(
      `SELECT ${reportColumns} FROM weekly_reports r JOIN users u ON u.id = r.user_id
       WHERE r.organization_id = $1 AND r.week_start = ${mondayOf('$2')} ORDER BY r.submitted_at`,
      [request.auth.organizationId, week],
    ),
    pool.query(
      `SELECT u.id, u.full_name AS "fullName", om.role FROM organization_members om JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1 ORDER BY u.full_name`,
      [request.auth.organizationId],
    ),
  ])
  const sent = new Set(reports.rows.map((row) => row.userId))
  return response.json({ reports: reports.rows, missing: members.rows.filter((member) => !sent.has(member.id)) })
}))

export default router
