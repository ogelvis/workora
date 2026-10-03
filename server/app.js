import 'dotenv/config'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { pool } from './db.js'
import authRoutes from './routes/auth.js'
import chatRoutes from './routes/chat.js'
import fileRoutes from './routes/files.js'
import teamRoutes from './routes/team.js'
import workspaceRoutes from './routes/workspace.js'

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

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
app.use(cookieParser())
app.use(express.json({ limit: '64kb' }))
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

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1')
    return response.json({ status: 'ok', database: 'connected' })
  } catch (error) {
    return next(error)
  }
})

app.use('/api/auth', authRoutes)
app.use('/api', workspaceRoutes)
app.use('/api', teamRoutes)
app.use('/api', fileRoutes)
app.use('/api', chatRoutes)
app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found.' }))

const distDir = path.resolve(rootDir, '..', 'dist')
if (isProduction && existsSync(distDir)) {
  app.use(express.static(distDir, { index: false }))
  app.get('*path', (request, response, next) => {
    if (request.path.startsWith('/api/')) return next()
    return response.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'That file is too large. Files can be up to 4 MB.' })
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return response.status(400).json({ error: 'Request body must contain valid JSON.' })
  }
  console.error('Request failed:', error)
  return response.status(500).json({ error: 'Something went wrong. Please try again.' })
})

export default app
