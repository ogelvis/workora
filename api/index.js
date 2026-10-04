let appPromise

// Load the Express app lazily so a configuration error (for example a missing
// DATABASE_URL in this Vercel environment) is reported as JSON instead of
// crashing the function with Vercel's plain-text error page.
function loadApp() {
  appPromise ||= import('../server/app.js').then((module) => module.default)
  return appPromise
}

// vercel.json rewrites every /api/* request to this one function and passes the original
// path as __path, because Vercel's file-based routing would otherwise only reach it for
// some path depths. Rebuild the URL Express should see from whichever form arrives.
export function originalUrl(requestUrl) {
  const url = new URL(requestUrl, 'http://localhost')
  const rewritten = url.searchParams.get('__path')
  if (rewritten !== null) {
    url.searchParams.delete('__path')
    const query = url.searchParams.toString()
    return `/api/${rewritten.replace(/^\/+/, '')}${query ? `?${query}` : ''}`
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return requestUrl
  return `/api${requestUrl.startsWith('/') ? '' : '/'}${requestUrl}`
}

export default async function handler(request, response) {
  let app
  try {
    app = await loadApp()
  } catch (error) {
    appPromise = undefined
    console.error('Workora API failed to start:', error)
    response.statusCode = 500
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({
      error: `Workora API is not configured: ${error.message} Set it under Vercel → Project → Settings → Environment Variables for this environment, then redeploy.`,
    }))
    return
  }
  request.url = originalUrl(request.url || '/')
  return app(request, response)
}
