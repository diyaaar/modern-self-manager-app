import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // TODO: Remove stored Google Calendar tokens from Supabase
  // For now, just return success
  
  return res.status(200).json({ success: true })
}

