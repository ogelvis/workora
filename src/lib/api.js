const unavailable = 'Workora API is unavailable. Start the API server and check your database configuration.'

async function readResponse(response) {
  if (response.status === 204) return null
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('Workora API did not return a valid response. Check that the API server is running.')
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'The request could not be completed.')
    error.status = response.status
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

export async function uploadFile(file, { folder, vault }) {
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
