import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key is not configured' })
  }

  try {
    const { taskTitle, taskDescription, userInput } = req.body

    if (!taskTitle) {
      return res.status(400).json({ error: 'taskTitle is required' })
    }

    const hasUserInput = userInput && userInput.trim().length > 0
    const userInputSection = hasUserInput 
      ? `\n\nUser's subtask ideas: "${userInput.trim()}"\n\nCRITICAL RULE: NEVER dismiss user's subtasks as "unrelated" or "random". ALWAYS find the logical connection to the main task and transform each subtask to show that connection clearly.`
      : '\n\nGenerate 5-7 practical, actionable subtasks based on the main task.'

    const prompt = `Given this task: "${taskTitle}"${taskDescription ? `\nDescription: ${taskDescription}` : ''}${userInputSection}

Rules for generating subtasks:
1. ${hasUserInput ? 'ALWAYS include ALL items mentioned by the user. For each user subtask:' : 'Generate 5-7 smart subtasks'}
   ${hasUserInput ? '   a. Ask: "Why would user mention this for THIS main task?"' : ''}
   ${hasUserInput ? '   b. Find the logical connection (think creatively and contextually)' : ''}
   ${hasUserInput ? '   c. Transform the subtask title to make the connection clear' : ''}
   ${hasUserInput ? '   d. User knows what they need - your job is to UNDERSTAND and ENHANCE, not filter out' : ''}
   ${hasUserInput ? '   Example: Main task "Instagram postu oluştur", user says "kahve iç" → Transform to "Kahve temalı içerik hazırla" or "Kahve içerik fikri geliştir"' : ''}
   ${hasUserInput ? '   Example: Main task "Blog yazısı yaz", user says "kahve yap" → Transform to "Kahve hazırla (yazma ortamı)" or "Yazma ortamı hazırla"' : ''}
2. ${hasUserInput ? 'Add 2-4 more intelligent subtasks that complement the user\'s ideas' : 'Make each subtask specific and actionable'}
3. Clean up titles: fix grammar, typos, make them clear and concise
4. Order them logically (what comes first, second, etc.)
5. Keep titles short and action-oriented (2-5 words ideal)
6. ${hasUserInput ? 'Don\'t duplicate - if user said something and you would suggest the same, don\'t repeat it' : 'Make them relevant to the main task'}
7. Handle Turkish and mixed-language input appropriately
8. ${hasUserInput ? 'Think contextually: If user mentions something that seems unrelated, find the creative connection (content theme, preparation step, inspiration source, etc.)' : ''}

Each subtask should be:
- Specific and actionable
- Clear and concise
- Relevant to the main task (or transformed to show relevance)

Return ONLY a JSON array of strings, no explanation or additional text.

Example format: ["Subtask 1", "Subtask 2", "Subtask 3", "Subtask 4", "Subtask 5"]`

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
            content: 'You are a helpful task management assistant. When users provide subtask ideas, NEVER dismiss them as unrelated. Always find the logical connection to the main task and transform user subtasks to show that connection clearly. Think contextually and creatively. Always return valid JSON arrays.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
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

    // Parse JSON from response (handle cases where response might have markdown code blocks)
    let suggestions: string[]
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0])
      } else {
        suggestions = JSON.parse(content)
      }
    } catch (parseError) {
      // Fallback: try to extract suggestions from text
      const lines = content
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0 && line.match(/^[-•\d]/))
        .map((line: string) => line.replace(/^[-•\d.\s]+/, '').trim())
        .filter((line: string) => line.length > 0)

      if (lines.length === 0) {
        return res.status(500).json({ error: 'Could not parse suggestions from response' })
      }
      suggestions = lines
    }

    // Validate and clean suggestions
    if (!Array.isArray(suggestions)) {
      return res.status(500).json({ error: 'Invalid response format: expected array' })
    }

    const cleanedSuggestions = suggestions
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0)
      .slice(0, 7) // Limit to 7 suggestions

    return res.status(200).json({ suggestions: cleanedSuggestions })
  } catch (error) {
    console.error('Error generating AI suggestions:', error)
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to generate suggestions' 
    })
  }
}

