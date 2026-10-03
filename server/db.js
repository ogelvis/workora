import 'dotenv/config'
import pg from 'pg'

const { Pool, types } = pg

// Return DATE columns as plain YYYY-MM-DD strings instead of timezone-shifted Date objects.
types.setTypeParser(1082, (value) => value)

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure Neon.')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL ? 1 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', (error) => {
  console.error('Unexpected idle database client error:', error)
})
