import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const migrationPath = fileURLToPath(new URL('./db/migrations/001_initial.sql', import.meta.url))

const client = await pool.connect()
try {
  const migration = await readFile(migrationPath, 'utf8')
  await client.query('BEGIN')
  await client.query(migration)
  await client.query('COMMIT')
  console.log('Database schema is up to date.')
} catch (error) {
  await client.query('ROLLBACK')
  console.error('Database migration failed:', error.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
