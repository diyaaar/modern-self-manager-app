import type { VercelRequest, VercelResponse } from '@vercel/node'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

// ── Supabase client factory ──────────────────────────────────
function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) return null

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ── Google OAuth client with token refresh ───────────────────
// This matches the logic in api/calendar/events.ts to ensure consistent auth
async function getAuthenticatedCalendar(supabase: any, userId: string) {
  if (!supabase) return null

  const { data: tokens, error: tokenError } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (tokenError || !tokens) return null

  let accessToken = tokens.access_token
  const now = Date.now()

  // Proactively refresh if token expires within 5 minutes
  if (tokens.expiry_date - now < 5 * 60 * 1000) {
    try {
      const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: tokens.refresh_token,
          grant_type: 'refresh_token',
        }),
      })

      if (refreshResponse.ok) {
        const refreshData = await refreshResponse.json()
        accessToken = refreshData.access_token
        await supabase
          .from('google_calendar_tokens')
          .update({
            access_token: refreshData.access_token,
            expiry_date: Date.now() + (refreshData.expires_in * 1000),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
      }
    } catch (err) {
      console.warn('[events/[id]] Token refresh failed, proceeding with existing token:', err)
    }
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2Client.setCredentials({ access_token: accessToken })

  return google.calendar({ version: 'v3', auth: oauth2Client })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Event ID is required' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const userId = req.query.user_id as string || (req.body && req.body.user_id) || null
  if (!userId) {
    return res.status(401).json({ error: 'User ID required' })
  }

  const supabase = getSupabase()
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase configuration missing' })
  }

  // Get authenticated calendar (this handles token refresh if needed)
  const calendar = await getAuthenticatedCalendar(supabase, userId)
  if (!calendar) {
    return res.status(401).json({ error: 'Google Calendar not connected or token expired' })
  }

  // ── PATCH: Update event using events.patch() ─────────────────
  if (req.method === 'PATCH') {
    try {
      const body = req.body

      // Determine target Google calendar ID
      let googleCalendarId = 'primary'
      const requestedCalendarId = (req.query.calendarId as string) || body?.calendarId

      if (requestedCalendarId && requestedCalendarId !== 'primary') {
        const { data: calRecord } = await supabase
          .from('calendars')
          .select('google_calendar_id')
          .eq('id', requestedCalendarId)
          .eq('user_id', userId)
          .maybeSingle()
        if (calRecord?.google_calendar_id) {
          googleCalendarId = calRecord.google_calendar_id
        }
      }

      console.log(`[PATCH] event=${id} calendar=${googleCalendarId}`)

      // Build start/end according to allDay flag
      type DateField = { date: string } | { dateTime: string; timeZone: string }
      let startField: DateField | undefined
      let endField: DateField | undefined

      if (body.allDay) {
        const startDate = typeof body.start === 'string' ? body.start.slice(0, 10) : undefined
        const endDate = typeof body.end === 'string' ? body.end.slice(0, 10) : undefined
        if (startDate) startField = { date: startDate }
        if (endDate) endField = { date: endDate }
      } else {
        const tz = body.timeZone || 'Europe/Istanbul'
        // Strip any trailing Z or +HH:MM offset so Google interprets the time
        // as a wall-clock time in the given timeZone, not as UTC.
        const stripOffset = (dt: string) => dt.replace(/(Z|[+-]\d{2}:\d{2})$/, '').slice(0, 19)
        if (body.start) startField = { dateTime: stripOffset(body.start), timeZone: tz }
        if (body.end) endField = { dateTime: stripOffset(body.end), timeZone: tz }
      }

      const patchBody: any = {}
      if (body.summary !== undefined) patchBody.summary = body.summary
      if (body.description !== undefined) patchBody.description = body.description || null
      if (body.location !== undefined) patchBody.location = body.location || null
      if (body.colorId !== undefined) patchBody.colorId = body.colorId ? String(body.colorId) : null
      if (startField) patchBody.start = startField
      if (endField) patchBody.end = endField

      const response = await calendar.events.patch({
        calendarId: googleCalendarId,
        eventId: id,
        requestBody: patchBody,
      })

      const ev = response.data
      return res.status(200).json({
        id: ev.id || '',
        summary: ev.summary || 'Başlıksız Etkinlik',
        description: ev.description || undefined,
        start: ev.start?.dateTime || ev.start?.date || '',
        end: ev.end?.dateTime || ev.end?.date || '',
        colorId: ev.colorId || undefined,
        location: ev.location || undefined,
        calendarId: requestedCalendarId || 'primary',
        allDay: !!ev.start?.date,
      })
    } catch (err) {
      console.error('Error updating event:', err)
      return res.status(500).json({ error: 'Failed to update event', detail: (err as any)?.message })
    }
  }

  // ── DELETE: Remove event ─────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      let googleCalendarId = 'primary'
      const requestedCalendarId = (req.query.calendarId as string)

      if (requestedCalendarId && requestedCalendarId !== 'primary') {
        const { data: calRecord } = await supabase
          .from('calendars')
          .select('google_calendar_id')
          .eq('id', requestedCalendarId)
          .eq('user_id', userId)
          .maybeSingle()
        if (calRecord?.google_calendar_id) {
          googleCalendarId = calRecord.google_calendar_id
        }
      }

      console.log(`[DELETE] event=${id} calendar=${googleCalendarId}`)

      await calendar.events.delete({ calendarId: googleCalendarId, eventId: id })
      return res.status(204).end()
    } catch (err: any) {
      if (err.code === 404 || err.code === 410) {
        return res.status(204).end()
      }
      console.error('Error deleting event:', err)
      return res.status(500).json({ error: 'Failed to delete event', detail: err?.message })
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` })
}
