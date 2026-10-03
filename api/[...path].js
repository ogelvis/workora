import app from '../server/app.js'

export default function handler(request, response) {
  const requestUrl = request.url || '/'
  const pathname = requestUrl.split('?')[0]
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return app(request, response)
  }
  request.url = `/api${requestUrl.startsWith('/') ? '' : '/'}${requestUrl}`
  return app(request, response)
}
