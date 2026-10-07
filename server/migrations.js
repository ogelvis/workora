import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db', 'migrations')
// Serverless bundles may omit the .sql files; fall back to the newest migration this code needs.
export const LATEST_MIGRATION = '017_messages_and_profiles.sql'

// Migrations this code expects that the database hasn't run yet.
export async function pendingMigrations() {
  const expected = await readdir(migrationsDir)
    .then((names) => names.filter((name) => /^\d+_.+\.sql$/.test(name)).sort())
    .catch(() => [LATEST_MIGRATION])
  let applied = []
  try {
    applied = (await pool.query('SELECT filename FROM schema_migrations')).rows.map((row) => row.filename)
  } catch {
    // schema_migrations does not exist until the first migration run.
  }
  return expected.filter((name) => !applied.includes(name))
}
