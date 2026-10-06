import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { AwsClient } from 'aws4fetch'

// Cloudflare R2 (S3-compatible) file storage. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY and R2_BUCKET in Vercel. Without them, files stay in the database.
const env = (name) => (process.env[name] || '').trim()

export function r2Configured() {
  return Boolean((env('R2_ACCOUNT_ID') || env('R2_ENDPOINT')) && env('R2_ACCESS_KEY_ID') && env('R2_SECRET_ACCESS_KEY') && env('R2_BUCKET'))
}

// Direct-to-R2 uploads skip Vercel's 4.5 MB request limit.
export const R2_MAX_FILE_BYTES = 100 * 1024 * 1024

let client
function r2() {
  if (!client) client = new AwsClient({ accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' })
  return client
}

function objectUrl(key) {
  const endpoint = (env('R2_ENDPOINT') || `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`).replace(/\/+$/, '')
  return `${endpoint}/${encodeURIComponent(env('R2_BUCKET'))}/${key.split('/').map(encodeURIComponent).join('/')}`
}

export function newStorageKey(organizationId, name) {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'
  return `org/${organizationId}/${randomUUID()}/${safe}`
}

async function signed(key, method, expiresSeconds, query = {}) {
  const url = new URL(objectUrl(key))
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds))
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  const request = await r2().sign(new Request(url, { method }), { aws: { signQuery: true } })
  return request.url
}

export function uploadUrl(key) {
  return signed(key, 'PUT', 15 * 60)
}

// A short-lived link the browser follows to download (or show) the file.
export function downloadUrl(key, name, { inline = false, mimeType } = {}) {
  const query = { 'response-content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}` }
  query['response-content-type'] = inline && mimeType ? mimeType : 'application/octet-stream'
  return signed(key, 'GET', 5 * 60, query)
}

export async function putObject(key, body, mimeType = 'application/octet-stream') {
  const response = await r2().fetch(objectUrl(key), { method: 'PUT', body, headers: { 'Content-Type': mimeType } })
  if (!response.ok) throw new Error(`R2 refused the upload (HTTP ${response.status}).`)
}

// Returns the stored object's size in bytes, or null when it isn't there.
export async function objectSize(key) {
  const response = await r2().fetch(objectUrl(key), { method: 'HEAD' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`R2 check failed (HTTP ${response.status}).`)
  return Number(response.headers.get('content-length'))
}

export async function getObject(key) {
  const response = await r2().fetch(objectUrl(key))
  if (!response.ok) throw new Error(`R2 download failed (HTTP ${response.status}).`)
  return Buffer.from(await response.arrayBuffer())
}

// Never throws: a file already gone from R2 shouldn't block deleting its record.
export async function deleteObjects(keys) {
  if (!r2Configured()) return
  await Promise.all(keys.filter(Boolean).map((key) => r2().fetch(objectUrl(key), { method: 'DELETE' }).catch((error) => console.warn('R2 delete failed:', error.message))))
}

// Upload tickets let the browser finish an upload it sent straight to R2, without a database row in between.
export function signTicket(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 30 * 60 * 1000 })).toString('base64url')
  const signature = createHmac('sha256', process.env.SESSION_SECRET).update(`upload.${body}`).digest('base64url')
  return `${body}.${signature}`
}

export function readTicket(ticket) {
  const [body, signature] = String(ticket || '').split('.')
  if (!body || !signature) return null
  const expected = createHmac('sha256', process.env.SESSION_SECRET).update(`upload.${body}`).digest()
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  return payload.exp > Date.now() ? payload : null
}
