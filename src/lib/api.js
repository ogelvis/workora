const unavailable = 'OVO API is unavailable. Start the API server and check your database configuration.'

// Explains a non-JSON reply, which comes from whatever sits in front of the API
// (the Vite dev proxy or Vercel) rather than from the API itself.
function describeBadResponse(status, text) {
  const vercelCode = text.match(/\b(FUNCTION_INVOCATION_[A-Z_]+|[A-Z]+_[A-Z_]{6,})\b/)?.[1]
  if (vercelCode === 'FUNCTION_INVOCATION_TIMEOUT' || status === 504) {
    return 'The server took too long to respond. The database may be waking up. Please try again in a moment.'
  }
  if (vercelCode) {
    return `The server crashed before it could answer (${vercelCode}). Check the function logs in Vercel and make sure DATABASE_URL and SESSION_SECRET are set for this environment.`
  }
  if (import.meta.env.DEV && status >= 500) {
    return 'The API server is not running. Start it with “npm run dev:api” in a second terminal.'
  }
  return `The server returned an unexpected response (HTTP ${status}). Please try again.`
}

async function readResponse(response) {
  if (response.status === 204) return null
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    const error = new Error(describeBadResponse(response.status, text))
    error.status = response.status
    throw error
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'The request could not be completed.')
    error.status = response.status
    error.code = payload.code
    throw error
  }
  return payload
}

export async function api(path, options = {}) {
  let response
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    })
  } catch {
    throw new Error(unavailable)
  }
  return readResponse(response)
}

// Sends a file straight to cloud storage when the server supports it.
// Returns null when it doesn't, so the caller can fall back to uploading through the API.
export async function directUpload(file, target, { caption, onProgress } = {}) {
  const start = await api('/api/uploads', { method: 'POST', body: { name: file.name, size: file.size, type: file.type || 'application/octet-stream', ...target } })
  if (!start.direct) return null
  await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', start.uploadUrl)
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100)) }
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`The upload failed (HTTP ${request.status}). Please try again.`)))
    request.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'))
    request.send(file)
  })
  return api('/api/uploads/complete', { method: 'POST', body: { ticket: start.ticket, caption } })
}

export async function uploadFile(file, { folder, vault, direct, onProgress }) {
  if (direct) {
    const result = await directUpload(file, { target: 'files', folder, vault: Boolean(vault) }, { onProgress })
    if (result) return result
  }
  const query = new URLSearchParams({ folder, vault: vault ? '1' : '0' })
  let response
  try {
    response = await fetch(`/api/files?${query}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Type': file.type || 'application/octet-stream',
      },
      body: file,
    })
  } catch {
    throw new Error(unavailable)
  }
  return readResponse(response)
}
