/**
 * Shared utilities for calendar event payload formatting.
 * Ensures consistent format across EventFormModal, Task "Takvime Ekle", and API.
 */

const DEFAULT_TIMEZONE = 'Europe/Istanbul'

/**
 * Format a Date to "YYYY-MM-DDTHH:mm:ss" (wall-clock, no timezone suffix).
 * Uses local browser time - suitable for Europe/Istanbul when user is in Turkey.
 */
export function formatDateTimeForCalendar(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
}

/**
 * Format a Date to "YYYY-MM-DD" for all-day events.
 */
export function formatDateForCalendar(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Normalize datetime-local string or Date to canonical format.
 * - allDay: "YYYY-MM-DD"
 * - timed: "YYYY-MM-DDTHH:mm:ss"
 */
export function normalizeToCalendarFormat(
  input: string | Date,
  isAllDay?: boolean
): string {
  if (input instanceof Date) {
    return isAllDay ? formatDateForCalendar(input) : formatDateTimeForCalendar(input)
  }
  if (!input || typeof input !== 'string') {
    return ''
  }
  const s = input.trim()
  if (isAllDay || s.length === 10) {
    return s.slice(0, 10)
  }
  // Timed: ensure "YYYY-MM-DDTHH:mm:ss"
  let cleaned = s.replace(/(Z|[+-]\d{2}:\d{2})$/, '')
  if (cleaned.length === 16) {
    cleaned += ':00'
  } else if (cleaned.length >= 19) {
    cleaned = cleaned.slice(0, 19)
  } else if (cleaned.length >= 10 && cleaned.length < 16) {
    cleaned = (cleaned + ':00').slice(0, 19)
  }
  return cleaned
}

export interface CalendarEventPayload {
  summary: string
  start: string
  end: string
  allDay: boolean
  timeZone?: string
  description?: string
  location?: string
  colorId?: string
  color?: string
  calendarId?: string
}

/**
 * Build a standardized calendar event payload for API.
 * Fills in missing fields (allDay, timeZone) and normalizes start/end format.
 */
export function buildCalendarEventPayload(raw: {
  summary: string
  start: string
  end: string
  allDay?: boolean
  timeZone?: string
  description?: string
  location?: string
  colorId?: string
  color?: string
  calendarId?: string
}): CalendarEventPayload {
  const allDay = raw.allDay ?? (raw.start.length === 10 && raw.end.length === 10)
  const timeZone = raw.timeZone ?? (allDay ? undefined : DEFAULT_TIMEZONE)

  const start = normalizeToCalendarFormat(raw.start, allDay)
  const end = normalizeToCalendarFormat(raw.end, allDay)

  return {
    summary: raw.summary.trim(),
    start,
    end,
    allDay,
    ...(timeZone && { timeZone }),
    ...(raw.description !== undefined && { description: raw.description }),
    ...(raw.location !== undefined && { location: raw.location }),
    ...(raw.colorId !== undefined && { colorId: raw.colorId }),
    ...(raw.color !== undefined && { color: raw.color }),
    ...(raw.calendarId !== undefined && { calendarId: raw.calendarId }),
  }
}
