import 'dotenv/config'
import app from './app.js'
import { pool } from './db.js'

const port = Number(process.env.PORT || 3001)
const server = app.listen(port, () => {
  console.log(`Workora API listening on port ${port}`)
})

async function shutdown() {
  server.close()
  await pool.end()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
