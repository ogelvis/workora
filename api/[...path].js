let appPromise

// Load the Express app lazily so a configuration error (for example a missing
// DATABASE_URL in this Vercel environment) is reported as JSON instead of
// crashing the function with Vercel's plain-text error page.
function loadApp() {
  appPromise ||= import('../server/app.js').then((module) => module.default)
  return appPromise
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
  const requestUrl = request.url || '/'
  const pathname = requestUrl.split('?')[0]
  if (pathname !== '/api' && !pathname.startsWith('/api/')) {
    request.url = `/api${requestUrl.startsWith('/') ? '' : '/'}${requestUrl}`
  }
  return app(request, response)
}
