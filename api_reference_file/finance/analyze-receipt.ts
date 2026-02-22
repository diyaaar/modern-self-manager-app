// ============================================================
// FINANCE DOMAIN — AI Receipt Analyzer
// POST /api/finance/analyze-receipt
//
// Accepts a base64 image of a receipt/invoice and the user's
// existing finance categories. Returns extracted transaction
// data with kuruş-converted amount (integer, never float).
//
// Architecture Rule: All monetary values are converted to
// integer kuruş (×100) before leaving this function.
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

interface CategoryInput {
    id: string
    name: string
    type: 'income' | 'expense'
}

interface ReceiptAnalysisResult {
    type: 'income' | 'expense'
    /** Integer kuruş (amount × 100). NEVER float. */
    amountKurus: number
    /** Display string e.g. "125.50" for form input field */
    amountTl: string
    /** ISO date string YYYY-MM-DD */
    date: string
    /** Short description / merchant name */
    note: string
    /** UUID of best-matching category from provided list, or null */
    matched_category_id: string | null
    /** Suggested name for a new category if none matched, or null */
    suggested_new_category_name: string | null
}

// The raw shape GPT is instructed to return
interface LlmReceiptOutput {
    type: 'income' | 'expense'
    amount: number
    date: string
    note: string
    matched_category_id: string | null
    suggested_new_category_name: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OpenAI API key is not configured' })
    }

    const {
        imageBase64,
        imageMimeType = 'image/jpeg',
        categories,
    } = req.body as {
        imageBase64: string
        imageMimeType: string
        categories: CategoryInput[]
    }

    if (!imageBase64) {
        return res.status(400).json({ error: 'imageBase64 is required' })
    }

    if (!categories || !Array.isArray(categories)) {
        return res.status(400).json({ error: 'categories array is required' })
    }

    // Build the category list string for the prompt
    const categoryListText =
        categories.length > 0
            ? categories
                .map((c) => `- id: "${c.id}", name: "${c.name}", type: "${c.type}"`)
                .join('\n')
            : '(no categories defined)'

    const today = new Date().toISOString().slice(0, 10)

    const systemPrompt = `You are a financial receipt analyzer. Your task is to extract transaction data from receipt or invoice images and return it as strict JSON.

Today's date: ${today}

The user has the following finance categories:
${categoryListText}

You MUST return ONLY a valid JSON object with exactly these fields (no markdown, no explanation):
{
  "type": "expense" or "income",
  "amount": <decimal number, e.g. 125.50>,
  "date": "<YYYY-MM-DD extracted from the receipt, or today if not found>",
  "note": "<merchant name + short description, max 60 characters>",
  "matched_category_id": "<id string from the category list above, or null if no good match>",
  "suggested_new_category_name": "<short Turkish category name suggestion if matched_category_id is null, e.g. 'Kozmetik', 'Market', 'Kargo', otherwise null>"
}

Rules:
- Most receipts are expenses. Only use income if the document is clearly a payment received.
- amount must be the TOTAL amount on the receipt (decimal, e.g. 89.90 — NOT in kuruş).
- Match the matched_category_id only when you are reasonably confident. Return null if unsure.
- Only one of matched_category_id or suggested_new_category_name may be non-null.
- suggested_new_category_name must be in Turkish and suitable for the Turkish finance domain.
- Return null for both category fields if the document is unclear.`

    try {
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt,
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'Analyze this receipt/invoice and extract the transaction data.',
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${imageMimeType};base64,${imageBase64}`,
                                    detail: 'high',
                                },
                            },
                        ],
                    },
                ],
                max_tokens: 500,
                temperature: 0.1,
            }),
        })

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ error: {} }))
            return res.status(response.status).json({
                error:
                    errorBody.error?.message ||
                    `OpenAI API error: ${response.statusText}`,
            })
        }

        const data = await response.json()
        const content: string = data.choices?.[0]?.message?.content

        if (!content) {
            return res.status(500).json({ error: 'No response from OpenAI' })
        }

        let parsed: LlmReceiptOutput
        try {
            parsed = JSON.parse(content)
        } catch {
            return res
                .status(500)
                .json({ error: 'Failed to parse AI response. Please try again.' })
        }

        // Validate the required fields
        if (
            !parsed.type ||
            !['income', 'expense'].includes(parsed.type) ||
            typeof parsed.amount !== 'number' ||
            parsed.amount <= 0
        ) {
            return res.status(500).json({
                error:
                    'Could not extract valid transaction data from this image. Please check the image and try again.',
            })
        }

        // Architecture Rule: convert float amount → integer kuruş here on the server.
        // Frontend NEVER receives raw float money.
        const amountKurus = Math.round(parsed.amount * 100)
        const amountTl = (amountKurus / 100).toFixed(2)

        // Validate that the matched_category_id actually exists in the provided list
        const validatedCategoryId =
            parsed.matched_category_id &&
                categories.some((c) => c.id === parsed.matched_category_id)
                ? parsed.matched_category_id
                : null

        const result: ReceiptAnalysisResult = {
            type: parsed.type,
            amountKurus,
            amountTl,
            date: parsed.date || today,
            note: (parsed.note || '').trim().slice(0, 120),
            matched_category_id: validatedCategoryId,
            suggested_new_category_name:
                validatedCategoryId ? null : (parsed.suggested_new_category_name || null),
        }

        return res.status(200).json(result)
    } catch (error) {
        console.error('Error analyzing receipt:', error)
        return res.status(500).json({
            error:
                error instanceof Error ? error.message : 'Failed to analyze receipt',
        })
    }
}
