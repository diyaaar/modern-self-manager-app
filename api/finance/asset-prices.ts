import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 saat

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// CollectAPI'den altın fiyatlarını çek
async function fetchGoldPrices(): Promise<Record<string, number>> {
  const apiKey = process.env.COLLECTAPI_KEY
  if (!apiKey) throw new Error('COLLECTAPI_KEY not configured')

  const res = await fetch('https://api.collectapi.com/economy/goldPrice', {
    headers: { Authorization: `apikey ${apiKey}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`CollectAPI goldPrice error: ${res.status}`)

  const data = await res.json()
  if (!data.success || !Array.isArray(data.result)) throw new Error('CollectAPI goldPrice unexpected format')

  // name → asset_key mapping (CollectAPI'nin döndürdüğü isimler değişebilir)
  const nameMap: Record<string, string> = {
    'Gram Altın': 'gold_gram',
    'Çeyrek Altın': 'gold_quarter',
    'Yarım Altın': 'gold_half',
    'Tam Altın': 'gold_full',
    'Ata Altın': 'gold_ata',
    'Ata Altını': 'gold_ata',
    'Cumhuriyet': 'gold_republic',
    'Cumhuriyet Altını': 'gold_republic',
    'Cumhuriyet Altınları': 'gold_republic',
  }

  const prices: Record<string, number> = {}
  const unmatchedNames: string[] = []
  for (const item of data.result) {
    const key = nameMap[item.name]
    if (!key) {
      if (item.name !== 'ONS' && item.name !== '14 Ayar Altın' && item.name !== '18 Ayar Altın' && item.name !== '22 Ayar Bilezik') {
        unmatchedNames.push(item.name)
      }
      continue
    }
    const buyPrice = parseFloat(item.buy ?? item.buying)
    if (!isNaN(buyPrice) && buyPrice > 0) {
      prices[key] = Math.round(buyPrice * 100)
    }
  }
  if (unmatchedNames.length > 0) {
    console.log('[asset-prices] Unmatched goldPrice names:', unmatchedNames)
  }
  return prices
}

// CollectAPI'den gümüş fiyatını çek
async function fetchSilverPrice(): Promise<number> {
  const apiKey = process.env.COLLECTAPI_KEY
  if (!apiKey) throw new Error('COLLECTAPI_KEY not configured')

  const res = await fetch('https://api.collectapi.com/economy/silverPrice', {
    headers: { Authorization: `apikey ${apiKey}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`CollectAPI silverPrice error: ${res.status}`)

  const data = await res.json()
  if (!data.success || !data.result) throw new Error('CollectAPI silverPrice unexpected format')

  const buying = parseFloat(data.result.buying)
  if (isNaN(buying)) throw new Error('CollectAPI silverPrice invalid buying value')

  return Math.round(buying * 100) // kuruş
}

// Frankfurter.app'tan döviz kurlarını çek
async function fetchCurrencyRates(): Promise<Record<string, number>> {
  const res = await fetch(
    'https://api.frankfurter.app/latest?from=TRY&to=USD,EUR,GBP,CHF',
    { signal: AbortSignal.timeout(5000) }
  )
  if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`)
  const data = await res.json()
  const rates: Record<string, number> = {}
  for (const [code, rate] of Object.entries(data.rates as Record<string, number>)) {
    // 1 TRY = rate USD → 1 USD = 1/rate TRY → kuruş cinsinden
    const tlPerUnit = 1 / rate
    rates[`${code.toLowerCase()}_try`] = Math.round(tlPerUnit * 100)
  }
  return rates
}

// Cache'den oku — force=true ise her zaman null döner (cache atlanır)
async function getCachedPrice(supabase: ReturnType<typeof getSupabase>, assetKey: string, force: boolean): Promise<number | null> {
  if (!supabase || force) return null

  const { data } = await supabase
    .from('asset_price_snapshots')
    .select('price_try, fetched_at')
    .eq('asset_key', assetKey)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const age = Date.now() - new Date(data.fetched_at).getTime()
  if (age > CACHE_TTL_MS) return null
  return data.price_try
}

// Cache'e yaz
async function setCachedPrice(supabase: ReturnType<typeof getSupabase>, assetKey: string, priceTry: number, source: string) {
  if (!supabase) return
  await supabase.from('asset_price_snapshots').insert({ asset_key: assetKey, price_try: priceTry, source })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getSupabase()

  try {
    const force = req.query.force === 'true'
    const ASSET_KEYS = ['gold_gram', 'gold_quarter', 'gold_half', 'gold_full', 'gold_ata', 'gold_republic', 'silver_gram', 'usd_try', 'eur_try', 'gbp_try', 'chf_try']
    const prices: Record<string, number> = {}
    const missing: string[] = []

    // Cache kontrolü (force=true ise cache atlanır)
    for (const key of ASSET_KEYS) {
      const cached = await getCachedPrice(supabase, key, force)
      if (cached !== null) {
        prices[key] = cached
      } else {
        missing.push(key)
      }
    }

    // Eksik olanları API'den çek
    if (missing.length > 0) {
      const goldKeys = missing.filter(k => k.startsWith('gold_'))
      const needsSilver = missing.includes('silver_gram')

      if (goldKeys.length > 0) {
        const goldPrices = await fetchGoldPrices()
        for (const key of goldKeys) {
          if (goldPrices[key] !== undefined) {
            prices[key] = goldPrices[key]
            await setCachedPrice(supabase, key, goldPrices[key], 'collectapi')
          }
        }
      }

      if (needsSilver) {
        const silverPrice = await fetchSilverPrice()
        prices['silver_gram'] = silverPrice
        await setCachedPrice(supabase, 'silver_gram', silverPrice, 'collectapi')
      }

      // Döviz kurları
      const currencyKeys = missing.filter(k => k.endsWith('_try'))
      if (currencyKeys.length > 0) {
        try {
          const currencyRates = await fetchCurrencyRates()
          for (const key of currencyKeys) {
            if (currencyRates[key] !== undefined) {
              prices[key] = currencyRates[key]
              await setCachedPrice(supabase, key, currencyRates[key], 'frankfurter')
            }
          }
        } catch (currErr: any) {
          console.warn('[asset-prices] Currency fetch failed:', currErr?.message)
        }
      }
    }

    // Kuruştan TL'ye çevir ve meta ekle
    const result: Record<string, { price_try: number; price_tl: number; source: string }> = {}
    for (const [key, priceTry] of Object.entries(prices)) {
      result[key] = {
        price_try: priceTry,
        price_tl: priceTry / 100,
        source: 'collectapi',
      }
    }

    return res.status(200).json({ success: true, prices: result, cached_at: new Date().toISOString() })
  } catch (err: any) {
    console.error('[asset-prices] Error:', err?.message)
    return res.status(500).json({ error: 'Failed to fetch asset prices', detail: err?.message })
  }
}
