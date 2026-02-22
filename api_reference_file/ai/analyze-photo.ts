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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key is not configured' })
  }

  try {
    const { imageBase64, imageMimeType = 'image/jpeg' } = req.body

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' })
    }

    const currentDateTime = getCurrentDateTime()

    const prompt = `Analyze this photo of a to-do list, notes, whiteboard, or task list. Extract all tasks and subtasks with their details.

Current date: ${currentDateTime.date}
Current day: ${currentDateTime.dayOfWeek}
Current time: ${currentDateTime.time}

Extract and identify:
1. Task titles (main tasks and subtasks)
2. Task descriptions/notes (any additional details written for each task)
3. Location information (if mentioned: "at grocery store", "office", "home", etc.)
4. Time information (if mentioned: "3pm", "morning", "after lunch", "by Friday", etc.)
5. Due dates (if mentioned: dates, days, deadlines - calculate exact dates based on current date)
6. Task hierarchy (which items are main tasks vs subtasks based on indentation, bullets, numbering, visual structure)
7. Tags/categories (suggest relevant tags based on content: "shopping", "work", "school", "home", "errands", etc.)
8. Priority indicators (if marked as urgent, important, high priority, etc.)

Return ONLY valid JSON in this exact format:
{
  "tasks": [
    {
      "title": "Buy groceries",
      "description": "Need items for dinner party",
      "location": "Whole Foods Market",
      "time": "before 6pm",
      "due_date": "2024-03-15",
      "type": "main",
      "subtasks": [
        {
          "title": "Get milk",
          "notes": "organic, 2%"
        },
        {
          "title": "Buy bread",
          "notes": "sourdough"
        }
      ],
      "suggested_tags": ["shopping", "errands"],
      "priority": "medium"
    }
  ]
}

Rules:
- Identify main tasks vs subtasks based on visual hierarchy (indentation, bullets, numbering)
- If an item is indented or numbered as a sub-item, it's a subtask
- Calculate exact dates for relative expressions (e.g., "tomorrow" means the day after ${currentDateTime.date})
- Extract time if mentioned (convert to 24-hour format if needed)
- Suggest relevant tags based on task content
- If priority is marked (urgent, important, etc.), include it
- Clean up task titles (remove filler words, fix typos)
- Return empty array if no tasks detected

Return ONLY valid JSON, no markdown, no explanations.`

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o', // GPT-4o supports vision
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imageMimeType};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.3,
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
    let parsed: { tasks: any[] }
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      } else {
        parsed = JSON.parse(content)
      }
    } catch (parseError) {
      return res.status(500).json({ 
        error: 'Failed to parse AI response. Please try again with a clearer image.' 
      })
    }

    // Validate structure
    if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
      return res.status(500).json({ error: 'Invalid response format: expected tasks array' })
    }

    // Ensure all tasks have required fields
    const validatedTasks = parsed.tasks
      .filter((task) => task.title && task.title.trim().length > 0)
      .map((task) => ({
        ...task,
        title: task.title.trim(),
        description: task.description?.trim(),
        location: task.location?.trim(),
        time: task.time?.trim(),
        type: task.type || 'main',
        subtasks: task.subtasks?.filter((st: any) => st.title && st.title.trim().length > 0) || [],
      }))

    if (validatedTasks.length === 0) {
      return res.status(500).json({ 
        error: 'No tasks detected in the image. Please try a clearer photo of your to-do list.' 
      })
    }

    return res.status(200).json({ tasks: validatedTasks })
  } catch (error) {
    console.error('Error analyzing photo:', error)
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to analyze photo' 
    })
  }
}

