import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // TODO: Check if user has stored Google Calendar tokens
  // For now, return false - will be implemented with token storage
  // In production, check Supabase for stored tokens
  
  return res.status(200).json({ authenticated: false })
}

