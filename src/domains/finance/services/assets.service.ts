import { getSupabaseClient } from '../../../lib/supabase'

// ── Types ─────────────────────────────────────────────────────

export type AssetType = 'gold' | 'silver' | 'platinum' | 'currency'
export type GoldSubtype = 'gram' | 'quarter' | 'half' | 'full' | 'ata' | 'republic'

export interface AssetHolding {
  id: string
  user_id: string
  type: AssetType
  subtype: GoldSubtype | null
  currency_code: string | null
  quantity: number
  purchase_price: number // kuruş
  purchase_date: string
  label: string | null
  note: string | null
  created_at: string
  updated_at: string | null
}

export interface AssetHoldingInsert {
  type: AssetType
  subtype?: GoldSubtype | null
  currency_code?: string | null
  quantity: number
  purchase_price: number // kuruş
  purchase_date: string
  label?: string | null
  note?: string | null
}

export interface AssetPrices {
  [key: string]: {
    price_try: number
    price_tl: number
    source: string
  }
}

export interface AssetHoldingEnriched extends AssetHolding {
  current_price_try: number  // birim başına güncel fiyat (kuruş)
  current_value_try: number  // toplam güncel değer (kuruş)
  purchase_value_try: number // toplam alış değeri (kuruş)
  profit_loss_try: number    // kar/zarar (kuruş)
  profit_loss_pct: number    // kar/zarar yüzdesi
}

// ── Helpers ───────────────────────────────────────────────────

function getSupabase() {
  return getSupabaseClient()
}

// asset_key mapping — DB/API key'ini belirler
export const ASSET_KEY_MAP: Record<AssetType, (subtype?: GoldSubtype | null, currencyCode?: string | null) => string> = {
  gold: (subtype) => {
    const map: Record<GoldSubtype, string> = {
      gram: 'gold_gram', quarter: 'gold_quarter', half: 'gold_half',
      full: 'gold_full', ata: 'gold_ata', republic: 'gold_republic',
    }
    return map[subtype ?? 'gram'] ?? 'gold_gram'
  },
  silver: () => 'silver_gram',
  platinum: () => 'platinum',
  currency: (_, code) => `${(code ?? 'usd').toLowerCase()}_try`,
}

export function getAssetKey(holding: Pick<AssetHolding, 'type' | 'subtype' | 'currency_code'>): string {
  return ASSET_KEY_MAP[holding.type](holding.subtype, holding.currency_code)
}

export const ASSET_LABELS: Record<string, string> = {
  gold_gram: 'Gram Altın',
  gold_quarter: 'Çeyrek Altın',
  gold_half: 'Yarım Altın',
  gold_full: 'Tam Altın',
  gold_ata: 'Ata Altın',
  gold_republic: 'Cumhuriyet Altını',
  silver_gram: 'Gram Gümüş',
  platinum: 'Platin',
  usd_try: 'USD/TRY',
  eur_try: 'EUR/TRY',
  gbp_try: 'GBP/TRY',
  chf_try: 'CHF/TRY',
}

export const GOLD_SUBTYPE_LABELS: Record<GoldSubtype, string> = {
  gram: 'Gram',
  quarter: 'Çeyrek',
  half: 'Yarım',
  full: 'Tam',
  ata: 'Ata',
  republic: 'Cumhuriyet',
}

export const CURRENCY_LABELS: Record<string, string> = {
  USD: 'Amerikan Doları',
  EUR: 'Euro',
  GBP: 'İngiliz Sterlini',
  CHF: 'İsviçre Frangı',
}

export function kurusToTl(kurus: number): number {
  return kurus / 100
}

export function tlToKurus(tl: number): number {
  return Math.round(tl * 100)
}

export function formatTl(kurus: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(kurus / 100)
}

// ── Fiyat Çekme ───────────────────────────────────────────────

export async function fetchAssetPrices(force = false): Promise<AssetPrices> {
  const url = force ? '/api/finance/asset-prices?force=true' : '/api/finance/asset-prices'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Fiyatlar alınamadı')
  const data = await res.json()
  return data.prices as AssetPrices
}

// ── Enrich ───────────────────────────────────────────────────

export function enrichHolding(holding: AssetHolding, prices: AssetPrices): AssetHoldingEnriched {
  const key = getAssetKey(holding)
  const currentPriceTry = prices[key]?.price_try ?? 0
  const currentValueTry = Math.round(currentPriceTry * holding.quantity)
  const purchaseValueTry = Math.round(holding.purchase_price * holding.quantity)
  const profitLossTry = currentValueTry - purchaseValueTry
  const profitLossPct = purchaseValueTry === 0 ? 0 : (profitLossTry / purchaseValueTry) * 100

  return {
    ...holding,
    current_price_try: currentPriceTry,
    current_value_try: currentValueTry,
    purchase_value_try: purchaseValueTry,
    profit_loss_try: profitLossTry,
    profit_loss_pct: profitLossPct,
  }
}

// ── CRUD ──────────────────────────────────────────────────────

export async function getHoldings(userId: string): Promise<AssetHolding[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('asset_holdings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function createHolding(userId: string, input: AssetHoldingInsert): Promise<AssetHolding> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('asset_holdings')
    .insert({ ...input, user_id: userId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateHolding(id: string, input: Partial<AssetHoldingInsert>): Promise<AssetHolding> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('asset_holdings')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteHolding(id: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.from('asset_holdings').delete().eq('id', id)
  if (error) throw error
}
