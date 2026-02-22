import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

// Helper function to get current date/time (server-side)
function getCurrentDateTime() {
  const now = new Date()
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const daysTurkish = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')

  return {
    date: `${year}-${month}-${day}`,
    dayOfWeek: days[now.getDay()],
    dayOfWeekTurkish: daysTurkish[now.getDay()],
    time: `${hours}:${minutes}`,
  }
}

// Detect tags from input text (same logic as frontend)
function detectTags(input: string): string[] {
  const lowerInput = input.toLowerCase()
  const tags: string[] = []

  // School tag detection
  const schoolKeywords = ['school', 'okul', 'homework', 'ödev', 'ders', 'lesson', 'exam', 'sınav', 'assignment', 'ödev']
  if (schoolKeywords.some(keyword => lowerInput.includes(keyword))) {
    tags.push('school')
  }

  // Work tag detection
  const workKeywords = ['work', 'iş', 'meeting', 'toplantı', 'project', 'proje', 'report', 'rapor', 'business', 'işletme']
  if (workKeywords.some(keyword => lowerInput.includes(keyword))) {
    tags.push('work')
  }

  // Home tag detection
  const homeKeywords = ['home', 'ev', 'shopping', 'alışveriş', 'house', 'ev işi', 'chore', 'grocery', 'market']
  if (homeKeywords.some(keyword => lowerInput.includes(keyword))) {
    tags.push('home')
  }

  return tags
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Multiplexing GET request for image search to not exceed Vercel 12-function limit
  if (req.method === 'GET' && req.query.action === 'image-search') {
    const q = req.query.q as string
    if (!q) return res.status(400).json({ error: 'q parameter is required' })

    try {
      const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json&origin=*`

      const searchRes = await fetch(url)
      const data = await searchRes.json()

      const pages = data.query?.pages || {}
      const results = Object.values(pages).map((p: any) => {
        const info = p.imageinfo?.[0]
        return {
          title: p.title.replace(/^File:/i, '').replace(/\.\w+$/, ''),
          image: info?.url,
          thumbnail: info?.thumburl || info?.url
        }
      }).filter((r: any) => r.image) // Only return items that actually have images

      return res.status(200).json({ results })
    } catch (err: any) {
      console.error('Wikimedia search error:', err)
      // Return empty results instead of 500 to keep UI graceful
      return res.status(200).json({ results: [] })
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key is not configured' })
  }

  try {
    const { input } = req.body

    if (!input) {
      return res.status(400).json({ error: 'input is required' })
    }

    // Get current date/time information
    const currentDateTime = getCurrentDateTime()

    // Detect tags from input
    const detectedTags = detectTags(input)

    const prompt = `Current date: ${currentDateTime.date}
Current day: ${currentDateTime.dayOfWeek} (${currentDateTime.dayOfWeekTurkish})
Current time: ${currentDateTime.time}

User input: "${input}"

Parse this natural language task input and return ONLY JSON in this exact format:
{
  "title": "clean, concise task title",
  "dueDate": "YYYY-MM-DD or null",
  "time": "HH:MM or null",
  "tags": ["school" or "work" or "home" or empty array],
  "priority": "low" or "medium" or "high" or null
}

CRITICAL: Title Cleaning Rules (MOST IMPORTANT):
1. Clean and improve the title:
   - Remove filler words: "like", "probably", "thing", "stuff", "falan", "falan filan", "vs", "etc"
   - Remove unnecessary phrases: "i need to", "i should", "i have to", "i want to", "i'm going to"
   - Fix typos and grammar errors
   - Capitalize properly (Title Case)
   - Make it concise (2-5 words ideal, max 8 words)
   - Remove redundant words
   - Handle Turkish input: translate to clean Turkish or English as appropriate
   - Handle mixed language: use the primary language detected

2. Title Examples:
   - "i need to like finish that homework thing for school tomorrow" → "Finish homework"
   - "buy milk and bread from market" → "Buy milk and bread"
   - "i should probably call mom because i haven't talked to her in a while" → "Call mom"
   - "marketten süt ekmek falan alıcam yarın" → "Marketten alışveriş yap" or "Buy groceries"
   - "finish the ödev for okul tomorrow saat 5" → "Finish homework"
   - "finsh homwork tmrw" → "Finish homework"
   - "i need to like do that thing" → Extract the actual task, remove filler

3. Date/Time Rules:
   - Calculate exact dates for relative expressions:
     * "next Thursday" / "haftaya perşembe" = next occurrence of Thursday
     * "next week today" / "haftaya bugün" = same day next week
     * "tomorrow" / "yarın" = tomorrow's date
     * Today is ${currentDateTime.dayOfWeek}, ${currentDateTime.date}
   - Extract time if mentioned (e.g., "at 3pm", "saat 15:00", "5'te")
   
4. Tag Detection:
   - "school" tag: "school", "okul", "homework", "ödev", "ders", "exam", "sınav"
   - "work" tag: "work", "iş", "meeting", "toplantı", "project", "proje", "report", "rapor"
   - "home" tag: "home", "ev", "shopping", "alışveriş", "market", "grocery"
   
5. Priority Detection:
   - "high": urgent, important, asap, acil, önemli
   - "medium": default for tasks with deadlines
   - "low": default for tasks without urgency

Return ONLY valid JSON, no explanation. The title MUST be clean, concise, and well-formatted.`

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful task management assistant. Your primary job is to clean and improve messy task descriptions into clean, concise, well-formatted task titles. Remove filler words, fix typos, correct grammar, and make titles concise (2-5 words ideal). Handle Turkish and mixed-language input. Always return valid JSON only, no markdown, no explanations.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      return res.status(response.status).json({
        error: error.error?.message || `OpenAI API error: ${response.statusText}`
      })
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content

    if (!content) {
      return res.status(500).json({ error: 'No response from OpenAI' })
    }

    // Parse JSON from response
    let parsed: any
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      } else {
        parsed = JSON.parse(content)
      }
    } catch (parseError) {
      // Fallback: return basic structure with detected tags
      // Fallback: return basic structure with detected tags
      return res.status(200).json({
        title: input,
        description: undefined,
        priority: undefined,
        deadline: undefined,
        time: undefined,
        tags: detectedTags.length > 0 ? detectedTags : undefined,
      })
    }

    // Process the parsed data - parse dates/times server-side to match frontend expectations
    // Import date parsing utilities (we'll need to handle this server-side)
    // For now, return the raw data and let frontend parse (to maintain compatibility)
    // Merge detected tags with AI-suggested tags
    const allTags = [...new Set([...detectedTags, ...(parsed.tags || [])])]

    return res.status(200).json({
      title: parsed.title || input,
      description: parsed.description || undefined,
      priority: parsed.priority || undefined,
      dueDate: parsed.dueDate || null,
      time: parsed.time || null,
      tags: allTags.length > 0 ? allTags : undefined,
    })
  } catch (error) {
    console.error('Error parsing natural language task:', error)

    // Fallback: return basic structure
    const detectedTags = detectTags(req.body.input || '')

    return res.status(200).json({
      title: req.body.input || '',
      description: undefined,
      priority: undefined,
      deadline: undefined,
      time: undefined,
      tags: detectedTags.length > 0 ? detectedTags : undefined,
    })
  }
}

