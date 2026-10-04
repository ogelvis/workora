import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { ADMINS, MANAGERS, route } from '../lib.js'

const router = express.Router()
router.use(requireAuth)

// One search box across the whole workspace, respecting what each role may see.
router.get('/search', route(async (request, response) => {
  const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(request.query)
  const { organizationId, userId, role } = request.auth
  const isManager = MANAGERS.includes(role)
  const pattern = `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
  const none = { rows: [] }
  const [clients, projects, tasks, files, sheets, records, people, messages] = await Promise.all([
    isManager ? pool.query(
      `SELECT id, name, contact_name AS "contactName", status FROM clients
       WHERE organization_id = $1 AND (name ILIKE $2 OR contact_name ILIKE $2 OR email ILIKE $2 OR industry ILIKE $2)
       ORDER BY created_at DESC LIMIT 6`,
      [organizationId, pattern],
    ) : none,
    isManager ? pool.query(
      `SELECT id, name, status FROM projects
       WHERE organization_id = $1 AND (name ILIKE $2 OR description ILIKE $2) ORDER BY created_at DESC LIMIT 6`,
      [organizationId, pattern],
    ) : none,
    pool.query(
      `SELECT id, title, status, priority FROM tasks
       WHERE organization_id = $1 AND (title ILIKE $2 OR description ILIKE $2) AND ($3 OR assignee_id = $4)
       ORDER BY created_at DESC LIMIT 6`,
      [organizationId, pattern, isManager, userId],
    ),
    pool.query(
      `SELECT id, name, folder, vault, mime_type AS "mimeType" FROM files
       WHERE organization_id = $1 AND (name ILIKE $2 OR folder ILIKE $2) AND (NOT vault OR $3)
       ORDER BY created_at DESC LIMIT 6`,
      [organizationId, pattern, ADMINS.includes(role)],
    ),
    pool.query(
      `SELECT id, name, icon, color FROM sheets
       WHERE organization_id = $1 AND (name ILIKE $2 OR description ILIKE $2) ORDER BY position LIMIT 6`,
      [organizationId, pattern],
    ),
    pool.query(
      `SELECT r.id, r.sheet_id AS "sheetId", s.name AS "sheetName", s.icon, s.color, s.columns, r.data
       FROM sheet_rows r JOIN sheets s ON s.id = r.sheet_id
       WHERE r.organization_id = $1 AND EXISTS (SELECT 1 FROM jsonb_each_text(r.data) v WHERE v.value ILIKE $2)
       ORDER BY r.updated_at DESC LIMIT 8`,
      [organizationId, pattern],
    ),
    pool.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, om.role FROM organization_members om JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1 AND (u.full_name ILIKE $2 OR u.email ILIKE $2) ORDER BY u.full_name LIMIT 6`,
      [organizationId, pattern],
    ),
    pool.query(
      `(SELECT m.id, m.body, m.created_at AS "createdAt", u.full_name AS "author", 'channel' AS kind, c.id AS "targetId", c.name AS "where"
        FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id LEFT JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND m.body ILIKE $2)
       UNION ALL
       (SELECT m.id, m.body, m.created_at, u.full_name, 'dm', d.id,
               (SELECT full_name FROM users WHERE id = CASE WHEN d.user_a = $3 THEN d.user_b ELSE d.user_a END)
        FROM direct_messages m JOIN direct_conversations d ON d.id = m.conversation_id LEFT JOIN users u ON u.id = m.sender_id
        WHERE d.organization_id = $1 AND (d.user_a = $3 OR d.user_b = $3) AND m.body ILIKE $2)
       ORDER BY "createdAt" DESC LIMIT 6`,
      [organizationId, pattern, userId],
    ),
  ])

  const needle = q.toLowerCase()
  return response.json({
    clients: clients.rows,
    projects: projects.rows,
    tasks: tasks.rows,
    files: files.rows,
    sheets: sheets.rows,
    // Show each record by its first column, plus the field that matched.
    records: records.rows.map(({ columns, data, ...row }) => {
      const first = columns[0]
      const hit = columns.find((column) => String(data[column.id] ?? '').toLowerCase().includes(needle))
      return {
        ...row,
        title: String((first && data[first.id]) ?? 'Untitled record'),
        match: hit && hit !== first ? `${hit.name}: ${String(data[hit.id]).slice(0, 80)}` : '',
      }
    }),
    people: people.rows,
    messages: messages.rows,
  })
}))

export default router
