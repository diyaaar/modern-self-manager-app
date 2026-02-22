import type { VercelRequest, VercelResponse } from '@vercel/node'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
// Helper to get the redirect URI
function getRedirectUri(req: VercelRequest) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI

  const host = req.headers.host
  if (host) {
    const protocol = host.includes('localhost') ? 'http' : 'https'
    return `${protocol}://${host}/api/calendar/auth/callback`
  }

  return 'http://localhost:3000/api/calendar/auth/callback'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const REDIRECT_URI = getRedirectUri(req)

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Google Client ID is not configured' })
  }

  // Get user_id from query parameter (passed from frontend)
  const userId = req.query.user_id as string
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' })
  }

  // Generate state token for CSRF protection and include user_id
  const randomState = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  const state = `${randomState}:${userId}`

  // Store state in a cookie for verification
  res.setHeader('Set-Cookie', `oauth_state=${randomState}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`)

  // Google OAuth URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events')
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)

  return res.redirect(authUrl.toString())
}

