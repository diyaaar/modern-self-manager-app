// ============================================================
// FINANCE — Exchange Rates API Route
// Fetches USD and EUR rates relative to TRY from frankfurter.app (ECB data).
// Returns how many TRY one unit of each foreign currency is worth.
// Cached for 5 minutes via Cache-Control header.
// No API key required. Safe server-side boundary — never called from client directly.
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node'

interface FrankfurterResponse {
    amount: number
    base: string
    date: string
    rates: {
        USD?: number
        EUR?: number
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    try {
        // Fetch: 1 TRY = ? USD / ? EUR
        const response = await fetch(
            'https://api.frankfurter.app/latest?from=TRY&to=USD,EUR',
            { signal: AbortSignal.timeout(5000) }
        )

        if (!response.ok) {
            throw new Error(`Frankfurter API error: ${response.status}`)
        }

        const data: FrankfurterResponse = await response.json()

        // Invert: we want 1 USD = ? TRY and 1 EUR = ? TRY
        const usdToTry = data.rates.USD ? Math.round((1 / data.rates.USD) * 100) / 100 : null
        const eurToTry = data.rates.EUR ? Math.round((1 / data.rates.EUR) * 100) / 100 : null

        if (!usdToTry || !eurToTry) {
            throw new Error('Invalid rates from API')
        }

        // Cache for 5 minutes (rates don't change that fast)
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

        return res.status(200).json({
            date: data.date,
            rates: {
                USD: usdToTry, // 1 USD = X TRY
                EUR: eurToTry, // 1 EUR = Y TRY
            },
        })
    } catch (err) {
        console.error('[exchange-rates] Failed to fetch rates:', err)
        return res.status(502).json({
            error: 'Kur bilgisi alınamadı',
        })
    }
}
