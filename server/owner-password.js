// Sets (or creates) the owner's console password straight in the database, for when
// the password is forgotten. Usage: npm run owner:password -- you@example.com "new password"
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { pool } from './db.js'

const [email, password] = process.argv.slice(2)
if (!email || !email.includes('@') || !password) {
  console.error('Usage: npm run owner:password -- you@example.com "new password"')
  process.exit(1)
}
if (password.length < 12) {
  console.error('The password must be at least 12 characters.')
  process.exit(1)
}

try {
  const address = email.trim().toLowerCase()
  const passwordHash = await bcrypt.hash(password, 12)
  const updated = await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id', [passwordHash, address])
  if (updated.rowCount) {
    // Sign out everywhere so the old password's sessions stop working.
    await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [updated.rows[0].id])
    console.log(`Password changed for ${address}.`)
  } else {
    await pool.query('INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3)', ['Workora owner', address, passwordHash])
    console.log(`Created an owner account for ${address}.`)
  }
  console.log('Make sure this email is in PLATFORM_ADMIN_EMAILS, then sign in at your private address.')
} finally {
  await pool.end()
}
