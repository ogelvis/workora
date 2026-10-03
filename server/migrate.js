import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const migrationsDir = fileURLToPath(new URL('./db/migrations/', import.meta.url))

const client = await pool.connect()
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  const migrations = (await readdir(migrationsDir))
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort()

  for (const filename of migrations) {
    const applied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename],
    )
    if (applied.rowCount) {
      console.log(`Skipping ${filename} (already applied)`)
      continue
    }
    const migration = await readFile(path.join(migrationsDir, filename), 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(migration)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
      await client.query('COMMIT')
      console.log(`Applied ${filename}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
  console.log('Database migrations completed.')
} catch (error) {
  console.error('Database migration failed:', error.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
