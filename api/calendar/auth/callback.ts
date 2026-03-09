import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
// Helper to get the frontend URL dynamically if not configured
function getFrontendUrl(req: VercelRequest) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL

  // Try to reconstruct from Host header
  const host = req.headers.host
  if (host) {
    const protocol = host.includes('localhost') ? 'http' : 'https'
    return `${protocol}://${host}`
  }

  return 'http://localhost:5173'
}

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
  const FRONTEND_URL = getFrontendUrl(req)
  const REDIRECT_URI = getRedirectUri(req)

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code, state, error } = req.query

  if (error) {
    return res.redirect(`${FRONTEND_URL}?calendar_error=${encodeURIComponent(error as string)}`)
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}?calendar_error=missing_parameters`)
  }

  // Verify state token (CSRF protection)
  // State format from Google: "random_string:user_id"
  // Stored state in cookie: "random_string" (without user_id)
  const stateParts = (state as string).split(':')
  const stateRandomPart = stateParts[0] // Extract just the random part
  const userId = stateParts.length > 1 ? stateParts[1] : null
  const storedState = req.cookies?.oauth_state

  if (!storedState || stateRandomPart !== storedState) {
    console.error('State verification failed:', {
      received: stateRandomPart,
      stored: storedState,
      fullState: state,
    })
    return res.redirect(`${FRONTEND_URL}?calendar_error=invalid_state`)
  }

  if (!userId) {
    return res.redirect(`${FRONTEND_URL}?calendar_error=missing_user_id`)
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        code: code as string,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      console.error('Token exchange error:', errorData)
      return res.redirect(`${FRONTEND_URL}?calendar_error=token_exchange_failed`)
    }

    const tokens = await tokenResponse.json()

    // Calculate expiry date
    const expiryDate = Date.now() + (tokens.expires_in * 1000)

    // Initialize Supabase client
    // In Vercel, use SUPABASE_URL (not VITE_SUPABASE_URL which is client-side only)
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables:', {
        hasUrl: !!supabaseUrl,
        hasServiceKey: !!supabaseServiceKey,
      })
      // If we're missing crucial config, redirect back to frontend with a clear error
      return res.redirect(`${FRONTEND_URL}?calendar_error=configuration_error`)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // Store tokens in Supabase
    const { error: dbError } = await supabase
      .from('google_calendar_tokens')
      .upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: expiryDate,
        token_type: tokens.token_type || 'Bearer',
        scope: tokens.scope,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      })

    if (dbError) {
      console.error('Error storing tokens:', dbError)
      return res.redirect(`${FRONTEND_URL}?calendar_error=storage_failed`)
    }

    return res.redirect(`${FRONTEND_URL}?calendar_connected=true`)
  } catch (err) {
    console.error('OAuth callback error:', err)
    return res.redirect(`${FRONTEND_URL}?calendar_error=connection_failed`)
  }
}

