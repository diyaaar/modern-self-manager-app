import type { VercelRequest, VercelResponse } from '@vercel/node'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

// ── Supabase ─────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ── Google Calendar auth + token refresh ─────────────────────
async function getAuthenticatedCalendar(supabase: ReturnType<typeof getSupabase>, userId: string) {
  if (!supabase) return null

  const { data: tokens, error } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !tokens) {
    if (error && error.code !== 'PGRST116') console.error('[calendar] Token fetch error:', error)
    return null
  }

  let accessToken = tokens.access_token
  if (tokens.expiry_date - Date.now() < 5 * 60 * 1000) {
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: tokens.refresh_token,
          grant_type: 'refresh_token',
        }),
      })
      if (r.ok) {
        const d = await r.json()
        accessToken = d.access_token
        await supabase
          .from('google_calendar_tokens')
          .update({ access_token: d.access_token, expiry_date: Date.now() + d.expires_in * 1000, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
      } else {
        return null // token revoked
      }
    } catch {
      // proceed with existing token
    }
  }

  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
  oauth2.setCredentials({ access_token: accessToken })
  return google.calendar({ version: 'v3', auth: oauth2 })
}

// ── Lookup google_calendar_id from our calendars table ───────
async function resolveGoogleCalendarId(supabase: any, userId: string, calendarId?: string | null): Promise<string> {
  if (!calendarId || calendarId === 'primary') return 'primary'
  const { data } = await supabase
    .from('calendars')
    .select('google_calendar_id')
    .eq('id', calendarId)
    .eq('user_id', userId)
    .maybeSingle()
  return data?.google_calendar_id || 'primary'
}

// ── Strip timezone offset so Google interprets as wall-clock ─
function stripOffset(dt: string): string {
  if (!dt || typeof dt !== 'string') throw new Error(`Invalid datetime: ${dt}`)
  let s = dt.replace(/(Z|[+-]\d{2}:\d{2})$/, '')
  if (s.length >= 19) s = s.slice(0, 19)
  else if (s.length === 16) s += ':00'
  else if (s.length >= 10) s = (s + ':00').slice(0, 19)
  return s
}

// ── CORS helper ───────────────────────────────────────────────
function cors(res: VercelResponse, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

// ── Route helpers ─────────────────────────────────────────────
function getRedirectUri(req: VercelRequest) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI
  const host = req.headers.host
  if (host) {
    const proto = host.includes('localhost') ? 'http' : 'https'
    return `${proto}://${host}/api/calendar/auth/callback`
  }
  return 'http://localhost:3000/api/calendar/auth/callback'
}

function getFrontendUrl(req: VercelRequest) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL
  const host = req.headers.host
  if (host) {
    const proto = host.includes('localhost') ? 'http' : 'https'
    return `${proto}://${host}`
  }
  return 'http://localhost:5173'
}

// ═══════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════

// GET /api/calendar/auth/connect
async function handleAuthConnect(req: VercelRequest, res: VercelResponse) {
  const REDIRECT_URI = getRedirectUri(req)
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return res.status(500).json({ error: 'Google Client ID not configured' })

  const userId = req.query.user_id as string
  if (!userId) return res.status(400).json({ error: 'user_id is required' })

  const randomState = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  const state = `${randomState}:${userId}`
  res.setHeader('Set-Cookie', `oauth_state=${randomState}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`)

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events')
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)

  return res.redirect(authUrl.toString())
}

// GET /api/calendar/auth/callback
async function handleAuthCallback(req: VercelRequest, res: VercelResponse) {
  const FRONTEND_URL = getFrontendUrl(req)
  const REDIRECT_URI = getRedirectUri(req)
  const { code, state, error } = req.query

  if (error) return res.redirect(`${FRONTEND_URL}?calendar_error=${encodeURIComponent(error as string)}`)
  if (!code || !state) return res.redirect(`${FRONTEND_URL}?calendar_error=missing_parameters`)

  const stateParts = (state as string).split(':')
  const stateRandom = stateParts[0]
  const userId = stateParts.length > 1 ? stateParts[1] : null
  const storedState = req.cookies?.oauth_state

  if (!storedState || stateRandom !== storedState) {
    console.error('State mismatch:', { received: stateRandom, stored: storedState })
    return res.redirect(`${FRONTEND_URL}?calendar_error=invalid_state`)
  }
  if (!userId) return res.redirect(`${FRONTEND_URL}?calendar_error=missing_user_id`)

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code: code as string,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    })
    if (!tokenRes.ok) {
      console.error('Token exchange error:', await tokenRes.json().catch(() => ({})))
      return res.redirect(`${FRONTEND_URL}?calendar_error=token_exchange_failed`)
    }
    const tokens = await tokenRes.json()

    const supabase = getSupabase()
    if (!supabase) return res.redirect(`${FRONTEND_URL}?calendar_error=configuration_error`)

    const { error: dbError } = await supabase
      .from('google_calendar_tokens')
      .upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: Date.now() + tokens.expires_in * 1000,
        token_type: tokens.token_type || 'Bearer',
        scope: tokens.scope,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (dbError) {
      console.error('Token storage error:', dbError)
      return res.redirect(`${FRONTEND_URL}?calendar_error=storage_failed`)
    }

    return res.redirect(`${FRONTEND_URL}?calendar_connected=true`)
  } catch (err) {
    console.error('OAuth callback error:', err)
    return res.redirect(`${FRONTEND_URL}?calendar_error=connection_failed`)
  }
}

// POST /api/calendar/auth/disconnect
async function handleAuthDisconnect(req: VercelRequest, res: VercelResponse) {
  cors(res, 'POST, OPTIONS')

  const userId = (req.query.user_id as string) || req.body?.user_id
  if (!userId) return res.status(400).json({ error: 'user_id is required' })

  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase configuration missing' })

  try {
    const { error: err } = await supabase.from('google_calendar_tokens').delete().eq('user_id', userId)
    if (err) {
      if (err.code === 'PGRST301' || err.code === 'PGRST116') {
        return res.status(200).json({ success: true, message: 'No tokens found to delete' })
      }
      return res.status(500).json({ error: 'Failed to disconnect', detail: err.message })
    }
    return res.status(200).json({ success: true, message: 'Google Calendar disconnected successfully' })
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to disconnect', detail: err?.message })
  }
}

// GET /api/calendar/auth/status
async function handleAuthStatus(_req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({ authenticated: false })
}

// GET /api/calendar/calendars — list from DB
// POST /api/calendar/calendars — sync from Google
async function handleCalendars(req: VercelRequest, res: VercelResponse) {
  cors(res)
  const userId = req.query.user_id as string
  if (!userId) return res.status(401).json({ error: 'User ID required' })

  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase configuration missing' })

  if (req.method === 'GET') {
    try {
      const { data: calendars, error } = await supabase
        .from('calendars')
        .select('*')
        .eq('user_id', userId)
        .order('is_primary', { ascending: false })
        .order('name', { ascending: true })

      if (error) {
        if (error.code === 'PGRST301' || error.message?.includes('Not Acceptable')) return res.status(200).json({ calendars: [] })
        throw error
      }
      return res.status(200).json({ calendars: calendars || [] })
    } catch (err) {
      console.error('[calendars GET]', err)
      return res.status(500).json({ error: 'Failed to fetch calendars' })
    }
  }

  if (req.method === 'POST') {
    try {
      const { data: tokens, error: tokenError } = await supabase
        .from('google_calendar_tokens')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (tokenError || !tokens) return res.status(401).json({ error: 'Google Calendar not connected' })

      let accessToken = tokens.access_token
      if (tokens.expiry_date - Date.now() < 5 * 60 * 1000) {
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: tokens.refresh_token,
            grant_type: 'refresh_token',
          }),
        })
        if (r.ok) {
          const d = await r.json()
          accessToken = d.access_token
          await supabase.from('google_calendar_tokens').update({ access_token: d.access_token, expiry_date: Date.now() + d.expires_in * 1000 }).eq('user_id', userId)
        } else {
          return res.status(401).json({ error: 'Google Calendar token expired. Please reconnect.' })
        }
      }

      const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
      oauth2.setCredentials({ access_token: accessToken })
      const cal = google.calendar({ version: 'v3', auth: oauth2 })

      let googleCalendars: any[] = []
      try {
        const r = await cal.calendarList.list({ minAccessRole: 'reader' })
        googleCalendars = r.data.items || []
      } catch (apiErr: any) {
        if (apiErr?.code === 401 || apiErr?.status === 401) {
          return res.status(401).json({ error: 'Google Calendar authentication failed. Please reconnect.' })
        }
        throw apiErr
      }

      const colorMap: Record<string, string> = {
        '1': '#a4bdfc', '2': '#7ae7bf', '3': '#dbadff', '4': '#ff887c',
        '5': '#fbd75b', '6': '#ffb878', '7': '#46d6db', '8': '#e1e1e1',
        '9': '#5484ed', '10': '#51b749', '11': '#dc2127',
      }

      const synced = []
      for (const gCal of googleCalendars) {
        if (!gCal.id) continue
        const color = gCal.backgroundColor || colorMap[gCal.colorId || ''] || '#3b82f6'
        const { data: existing } = await supabase.from('calendars').select('id').eq('user_id', userId).eq('google_calendar_id', gCal.id).maybeSingle()

        if (existing) {
          const { data: updated } = await supabase.from('calendars')
            .update({ name: gCal.summary || 'Untitled Calendar', color, is_primary: gCal.primary === true, updated_at: new Date().toISOString() })
            .eq('id', existing.id).select().single()
          if (updated) synced.push(updated)
        } else {
          const { data: created } = await supabase.from('calendars')
            .insert({ user_id: userId, name: gCal.summary || 'Untitled Calendar', color, is_primary: gCal.primary === true, google_calendar_id: gCal.id })
            .select().single()
          if (created) synced.push(created)
        }
      }

      return res.status(200).json({ calendars: synced })
    } catch (err: any) {
      console.error('[calendars POST]', err?.message)
      if (err?.message?.includes('authentication credentials') || err?.code === 401) {
        return res.status(401).json({ error: 'Google Calendar authentication failed. Please reconnect.' })
      }
      return res.status(500).json({ error: 'Failed to sync calendars', detail: err?.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// GET /api/calendar/events — list events
// POST /api/calendar/events — create event
async function handleEvents(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' })

  const userId = (req.query.user_id as string) || req.body?.user_id
  if (!userId) return res.status(401).json({ error: 'User ID required' })

  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase configuration missing' })

  if (req.method === 'GET') {
    try {
      const { timeMin, timeMax, calendarIds } = req.query
      if (!timeMin || !timeMax) return res.status(400).json({ error: 'timeMin and timeMax are required' })

      const calendar = await getAuthenticatedCalendar(supabase, userId)
      if (!calendar) return res.status(401).json({ error: 'Google Calendar not connected. Please reconnect.' })

      const requestedIds = calendarIds ? (calendarIds as string).split(',').filter(Boolean) : []
      const { data: userCalendars } = await supabase.from('calendars').select('*').eq('user_id', userId)

      let toFetch: Array<{ id: string; googleId: string; color: string; name: string }> = []
      if (userCalendars && userCalendars.length > 0) {
        const filtered = requestedIds.length > 0 ? userCalendars.filter((c: any) => requestedIds.includes(c.id)) : userCalendars
        toFetch = filtered.filter((c: any) => c.google_calendar_id).map((c: any) => ({ id: c.id, googleId: c.google_calendar_id, color: c.color, name: c.name }))
      }
      if (toFetch.length === 0) toFetch = [{ id: 'primary', googleId: 'primary', color: '#10b981', name: 'Primary' }]

      const allEvents: any[] = []
      for (const cal of toFetch) {
        try {
          const r = await calendar.events.list({ calendarId: cal.googleId, timeMin: timeMin as string, timeMax: timeMax as string, maxResults: 2500, singleEvents: true, orderBy: 'startTime' })
          for (const item of r.data.items || []) {
            if (!item?.id) continue
            allEvents.push({
              id: item.id,
              summary: item.summary || 'Untitled Event',
              description: item.description || undefined,
              start: item.start?.dateTime || item.start?.date || '',
              end: item.end?.dateTime || item.end?.date || '',
              allDay: !item.start?.dateTime,
              colorId: item.colorId || undefined,
              location: item.location || undefined,
              calendarId: cal.id,
              color: cal.color,
            })
          }
        } catch (err: any) {
          if (err.code === 401 || err.status === 401 || err.code === 403 || err.status === 403) continue
          console.error(`[events GET] Error fetching ${cal.name}:`, err?.message)
        }
      }

      allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      return res.status(200).json({ events: allEvents })
    } catch (err: any) {
      console.error('[events GET]', err?.message)
      return res.status(500).json({ error: 'Failed to fetch events' })
    }
  }

  if (req.method === 'POST') {
    try {
      const { summary, title, description, start, end, startDate, endDate, startDateTime, endDateTime, allDay, colorId, location, calendarId: reqCalId, timeZone } = req.body
      const eventTitle = (summary || title || '').trim()
      if (!eventTitle) return res.status(400).json({ error: 'Event title (summary) is required' })

      const calendar = await getAuthenticatedCalendar(supabase, userId)
      if (!calendar) return res.status(401).json({ error: 'Google Calendar not connected. Please reconnect.' })

      const googleCalendarId = await resolveGoogleCalendarId(supabase, userId, reqCalId)
      const tz = timeZone || 'Europe/Istanbul'
      const isAllDay = allDay === true || (typeof start === 'string' && start.length === 10)

      let googleStart: any, googleEnd: any
      if (isAllDay) {
        const sDate = startDate || (typeof start === 'string' ? start.slice(0, 10) : null)
        if (!sDate) return res.status(400).json({ error: 'startDate is required for all-day events' })
        let eDate = endDate || (typeof end === 'string' ? end.slice(0, 10) : sDate)
        if (sDate === eDate) {
          const d = new Date(sDate); d.setDate(d.getDate() + 1); eDate = d.toISOString().slice(0, 10)
        }
        googleStart = { date: sDate }; googleEnd = { date: eDate || sDate }
      } else {
        const sDt = startDateTime || start, eDt = endDateTime || end
        if (!sDt || !eDt) return res.status(400).json({ error: 'start and end dateTime are required' })
        try {
          googleStart = { dateTime: stripOffset(sDt), timeZone: tz }
          googleEnd = { dateTime: stripOffset(eDt), timeZone: tz }
        } catch (e: any) {
          return res.status(400).json({ error: 'Invalid datetime format', detail: e?.message })
        }
      }

      const r = await calendar.events.insert({ calendarId: googleCalendarId, requestBody: { summary: eventTitle, description: description || undefined, location: location || undefined, start: googleStart, end: googleEnd, colorId: colorId ? String(colorId) : undefined } })
      const ev = r.data
      return res.status(200).json({ id: ev.id || '', summary: ev.summary || 'Untitled Event', description: ev.description || undefined, start: ev.start?.dateTime || ev.start?.date || '', end: ev.end?.dateTime || ev.end?.date || '', allDay: !ev.start?.dateTime, colorId: ev.colorId || undefined, location: ev.location || undefined, calendarId: reqCalId || 'primary' })
    } catch (err: any) {
      if (err.code === 401 || err.status === 401) return res.status(401).json({ error: 'Google Calendar authentication failed', detail: err?.message })
      if (err.code === 403 || err.status === 403) return res.status(403).json({ error: 'Google Calendar access denied', detail: err?.message })
      console.error('[events POST]', err?.message)
      return res.status(500).json({ error: 'Failed to create event', detail: err?.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// PATCH /api/calendar/events/:id — update event
// DELETE /api/calendar/events/:id — delete event
async function handleEventById(req: VercelRequest, res: VercelResponse, id: string) {
  cors(res, 'GET, PATCH, DELETE, OPTIONS')
  if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' })

  const userId = (req.query.user_id as string) || req.body?.user_id
  if (!userId) return res.status(401).json({ error: 'User ID required' })

  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase configuration missing' })

  const calendar = await getAuthenticatedCalendar(supabase, userId)
  if (!calendar) return res.status(401).json({ error: 'Google Calendar not connected or token expired' })

  if (req.method === 'PATCH') {
    try {
      const body = req.body
      const requestedCalId = (req.query.calendarId as string) || body?.calendarId
      const googleCalendarId = await resolveGoogleCalendarId(supabase, userId, requestedCalId)

      let startField: any, endField: any
      if (body.allDay !== undefined) {
        if (body.allDay) {
          const startDate = typeof body.start === 'string' ? body.start.slice(0, 10) : undefined
          let endDate = typeof body.end === 'string' ? body.end.slice(0, 10) : undefined
          if (startDate && startDate === endDate) {
            const d = new Date(startDate); d.setDate(d.getDate() + 1); endDate = d.toISOString().slice(0, 10)
          }
          if (startDate) startField = { date: startDate, dateTime: null }
          if (endDate) endField = { date: endDate, dateTime: null }
        } else {
          const tz = body.timeZone || 'Europe/Istanbul'
          if (body.start) startField = { dateTime: stripOffset(body.start), timeZone: tz, date: null }
          if (body.end) endField = { dateTime: stripOffset(body.end), timeZone: tz, date: null }
        }
      } else {
        if (body.start) {
          const isDateOnly = body.start.length === 10
          startField = isDateOnly ? { date: body.start } : { dateTime: stripOffset(body.start), timeZone: body.timeZone || 'Europe/Istanbul' }
        }
        if (body.end) {
          const isDateOnly = body.end.length === 10
          endField = isDateOnly ? { date: body.end } : { dateTime: stripOffset(body.end), timeZone: body.timeZone || 'Europe/Istanbul' }
        }
      }

      const patchBody: any = {}
      if (body.summary !== undefined) patchBody.summary = body.summary
      if (body.description !== undefined) patchBody.description = body.description || null
      if (body.location !== undefined) patchBody.location = body.location || null
      if (body.colorId !== undefined) patchBody.colorId = body.colorId ? String(body.colorId) : null
      if (startField) patchBody.start = startField
      if (endField) patchBody.end = endField

      const r = await calendar.events.patch({ calendarId: googleCalendarId, eventId: id, requestBody: patchBody })
      const ev = r.data
      return res.status(200).json({ id: ev.id || '', summary: ev.summary || 'Başlıksız Etkinlik', description: ev.description || undefined, start: ev.start?.dateTime || ev.start?.date || '', end: ev.end?.dateTime || ev.end?.date || '', colorId: ev.colorId || undefined, location: ev.location || undefined, calendarId: requestedCalId || 'primary', allDay: !!ev.start?.date })
    } catch (err: any) {
      if (err.code === 401 || err.status === 401) return res.status(401).json({ error: 'Google Calendar authentication failed', detail: err?.message })
      if (err.code === 403 || err.status === 403) return res.status(403).json({ error: 'Google Calendar access denied', detail: err?.message })
      if (err.code === 404 || err.status === 404) return res.status(404).json({ error: 'Event not found', detail: err?.message })
      console.error('[events PATCH]', err?.message)
      return res.status(500).json({ error: 'Failed to update event', detail: err?.message })
    }
  }

  if (req.method === 'DELETE') {
    try {
      const requestedCalId = (req.query.calendarId as string) || req.body?.calendarId
      const googleCalendarId = await resolveGoogleCalendarId(supabase, userId, requestedCalId)
      await calendar.events.delete({ calendarId: googleCalendarId, eventId: id })
      return res.status(204).end()
    } catch (err: any) {
      if (err.code === 404 || err.code === 410 || err.status === 404 || err.status === 410) return res.status(204).end()
      if (err.code === 401 || err.status === 401) return res.status(401).json({ error: 'Google Calendar authentication failed', detail: err?.message })
      if (err.code === 403 || err.status === 403) return res.status(403).json({ error: 'Google Calendar access denied', detail: err?.message })
      console.error('[events DELETE]', err?.message)
      return res.status(500).json({ error: 'Failed to delete event', detail: err?.message })
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` })
}

// ═══════════════════════════════════════════════════════════════
// MAIN ROUTER
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = (req.query.slug as string[]) || []
  const path = slug.join('/')

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.status(200).end()
  }

  // auth/connect
  if (path === 'auth/connect') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    return handleAuthConnect(req, res)
  }

  // auth/callback
  if (path === 'auth/callback') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    return handleAuthCallback(req, res)
  }

  // auth/disconnect
  if (path === 'auth/disconnect') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    return handleAuthDisconnect(req, res)
  }

  // auth/status
  if (path === 'auth/status') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    return handleAuthStatus(req, res)
  }

  // calendars
  if (path === 'calendars') {
    return handleCalendars(req, res)
  }

  // events/:id
  if (slug[0] === 'events' && slug.length === 2) {
    return handleEventById(req, res, slug[1])
  }

  // events
  if (path === 'events') {
    return handleEvents(req, res)
  }

  return res.status(404).json({ error: `Unknown calendar route: ${path}` })
}
