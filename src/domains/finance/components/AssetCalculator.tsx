import { useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, Info, Trophy, Target, Zap } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, ReferenceDot,
} from 'recharts'
import { formatTl, CURRENCY_LABELS, GOLD_SUBTYPE_LABELS, type AssetPrices } from '../services/assets.service'

type AssetKey = 'gold_gram' | 'gold_quarter' | 'gold_half' | 'gold_full' | 'gold_ata' | 'gold_republic' | 'silver_gram' | 'platinum' | 'usd_try' | 'eur_try' | 'gbp_try' | 'chf_try'
type AssetCategory = 'gold' | 'silver' | 'platinum' | 'currency'
type Frequency = 'daily' | 'weekly' | 'monthly'
type Duration = 1 | 3 | 5 | 10

interface Props {
  prices: AssetPrices
}

const CATEGORY_OPTIONS: { key: AssetCategory; label: string; emoji: string }[] = [
  { key: 'gold', label: 'Altın', emoji: '🥇' },
  { key: 'silver', label: 'Gümüş', emoji: '🥈' },
  { key: 'platinum', label: 'Platin', emoji: '💎' },
  { key: 'currency', label: 'Döviz', emoji: '💵' },
]

const GOLD_SUBTYPE_KEYS: { key: AssetKey; subtype: string }[] = [
  { key: 'gold_gram', subtype: 'gram' },
  { key: 'gold_quarter', subtype: 'quarter' },
  { key: 'gold_half', subtype: 'half' },
  { key: 'gold_full', subtype: 'full' },
  { key: 'gold_ata', subtype: 'ata' },
  { key: 'gold_republic', subtype: 'republic' },
]

const CURRENCY_KEYS: { key: AssetKey; code: string }[] = [
  { key: 'usd_try', code: 'USD' },
  { key: 'eur_try', code: 'EUR' },
  { key: 'gbp_try', code: 'GBP' },
  { key: 'chf_try', code: 'CHF' },
]

const ASSET_KEY_TO_LABEL: Record<AssetKey, string> = {
  gold_gram: 'Gram Altın', gold_quarter: 'Çeyrek Altın', gold_half: 'Yarım Altın',
  gold_full: 'Tam Altın', gold_ata: 'Ata Altın', gold_republic: 'Cumhuriyet Altını',
  silver_gram: 'Gram Gümüş', platinum: 'Platin',
  usd_try: 'USD/TRY', eur_try: 'EUR/TRY', gbp_try: 'GBP/TRY', chf_try: 'CHF/TRY',
}


const FREQUENCY_OPTIONS: { value: Frequency; label: string; perYear: number; desc: string }[] = [
  { value: 'daily', label: 'Günlük', perYear: 365, desc: 'Her gün' },
  { value: 'weekly', label: 'Haftalık', perYear: 52, desc: 'Her hafta' },
  { value: 'monthly', label: 'Aylık', perYear: 12, desc: 'Her ay' },
]

const DURATION_OPTIONS: Duration[] = [1, 3, 5, 10]

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1a1a2e] border border-white/10 rounded-xl px-3 py-2.5 text-xs shadow-2xl min-w-[180px]">
      <p className="text-text-tertiary mb-2 font-medium">{label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-text-tertiary">
            <span className="w-2 h-2 rounded-full bg-primary inline-block" />
            Sabit fiyat
          </span>
          <span className="text-white font-medium">{formatTl(payload[0]?.value ?? 0)}</span>
        </div>
        {payload[1] && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-text-tertiary">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              Değer artışlı
            </span>
            <span className="text-emerald-400 font-medium">{formatTl(payload[1]?.value ?? 0)}</span>
          </div>
        )}
        {payload[1] && payload[0] && (
          <div className="pt-1 mt-1 border-t border-white/5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-text-tertiary/60">Artış etkisi</span>
              <span className="text-amber-400 font-medium">
                +{formatTl((payload[1]?.value ?? 0) - (payload[0]?.value ?? 0))}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'blue' | 'green' | 'red' | 'amber' | 'none' }) {
  const colors = {
    blue: 'bg-primary/10 border-primary/20',
    green: 'bg-emerald-500/10 border-emerald-500/20',
    red: 'bg-red-500/10 border-red-500/20',
    amber: 'bg-amber-500/10 border-amber-500/20',
    none: 'bg-white/[0.03] border-white/5',
  }
  const textColors = {
    blue: 'text-primary',
    green: 'text-emerald-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    none: 'text-white',
  }
  const a = accent ?? 'none'
  return (
    <div className={`rounded-2xl border p-4 ${colors[a]}`}>
      <p className="text-text-tertiary text-xs mb-1.5">{label}</p>
      <p className={`font-bold text-base leading-tight ${textColors[a]}`}>{value}</p>
      {sub && <p className="text-text-tertiary text-[11px] mt-1">{sub}</p>}
    </div>
  )
}

function MilestoneCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${color}`}>
      <Icon className="w-4 h-4 flex-shrink-0 opacity-70" />
      <div className="min-w-0">
        <p className="text-text-tertiary text-[10px]">{label}</p>
        <p className="text-white text-xs font-semibold truncate">{value}</p>
      </div>
    </div>
  )
}

export function AssetCalculator({ prices }: Props) {
  const [assetKey, setAssetKey] = useState<AssetKey>('gold_gram')
  const [category, setCategory] = useState<AssetCategory>('gold')
  const [frequency, setFrequency] = useState<Frequency>('monthly')
  const [amount, setAmount] = useState('1')
  const [duration, setDuration] = useState<Duration>(1)
  const [startAmount, setStartAmount] = useState('')
  const [annualGrowth, setAnnualGrowth] = useState('8')
  const [customPrice, setCustomPrice] = useState('')

  const selectedLabel = ASSET_KEY_TO_LABEL[assetKey]
  const livePrice = prices[assetKey]?.price_tl ?? 0
  const currentPriceTl = customPrice && parseFloat(customPrice) > 0 ? parseFloat(customPrice) : livePrice
  const hasLivePrice = livePrice > 0

  function selectCategory(cat: AssetCategory) {
    setCategory(cat)
    setCustomPrice('')
    if (cat === 'gold') setAssetKey('gold_gram')
    else if (cat === 'silver') setAssetKey('silver_gram')
    else if (cat === 'platinum') setAssetKey('platinum')
    else if (cat === 'currency') setAssetKey('usd_try')
  }

  const result = useMemo(() => {
    const qty = parseFloat(amount) || 0
    const start = parseFloat(startAmount) || 0
    const growth = parseFloat(annualGrowth) || 0
    const freq = FREQUENCY_OPTIONS.find(f => f.value === frequency)!
    const periodsPerYear = freq.perYear
    const totalPeriods = periodsPerYear * duration

    if (qty <= 0 || currentPriceTl <= 0) return null

    const totalAccumulated = start + qty * totalPeriods
    const valueAtCurrentPrice = totalAccumulated * currentPriceTl
    const growthRate = growth / 100

    // Bileşik artışlı değer
    let valueWithGrowth = start * currentPriceTl * Math.pow(1 + growthRate, duration)
    for (let p = 1; p <= totalPeriods; p++) {
      const yearsRemaining = (totalPeriods - p) / periodsPerYear
      valueWithGrowth += qty * currentPriceTl * Math.pow(1 + growthRate, yearsRemaining)
    }

    const totalSpent = (start + qty * totalPeriods) * currentPriceTl
    const profit = valueWithGrowth - totalSpent

    // Grafik — yıllık nokta
    const chartData = Array.from({ length: duration + 1 }, (_, i) => {
      const label = i === 0 ? 'Başlangıç' : `${i}. Yıl`
      const accumulated = start + qty * periodsPerYear * i
      const baseValue = Math.round(accumulated * currentPriceTl * 100)
      let grownValue = Math.round(
        start * currentPriceTl * Math.pow(1 + growthRate, i) * 100 +
        (i === 0 ? 0 : Array.from({ length: periodsPerYear * i }, (_, p) => {
          const yr = (periodsPerYear * i - p) / periodsPerYear
          return qty * currentPriceTl * Math.pow(1 + growthRate, yr)
        }).reduce((a, b) => a + b, 0) * 100)
      )
      return { label, baseValue, grownValue, year: i }
    })

    // Milestones
    const kgInGrams = 1000
    const totalGrams = assetKey.startsWith('gold') || assetKey === 'silver_gram'
      ? totalAccumulated
      : null

    // Kaç yılda hedef değere ulaşır?
    const targetValues = [100_000_00, 500_000_00, 1_000_000_00] // kuruş cinsinden
    const yearToTarget: { target: number; years: number | null }[] = targetValues.map(target => {
      if (valueWithGrowth * 100 < target) return { target, years: null }
      // binary search-ish: find the year chartData first exceeds target
      const hit = chartData.find(d => d.grownValue >= target)
      return { target, years: hit ? hit.year : null }
    })

    // Aylık breakdown (sadece ilk 12 ay)
    const monthlyBreakdown = Array.from({ length: Math.min(12, totalPeriods) }, (_, mo) => {
      const periodsElapsed = frequency === 'monthly' ? mo + 1 : Math.floor((mo + 1) * periodsPerYear / 12)
      const accumulated = start + qty * periodsElapsed
      const yr = periodsElapsed / periodsPerYear
      let grown =
        start * currentPriceTl * Math.pow(1 + growthRate, yr) +
        Array.from({ length: periodsElapsed }, (_, p) => {
          const yrs = (periodsElapsed - p) / periodsPerYear
          return qty * currentPriceTl * Math.pow(1 + growthRate, yrs)
        }).reduce((a, b) => a + b, 0)

      return {
        month: mo + 1,
        accumulated: accumulated.toLocaleString('tr-TR', { maximumFractionDigits: 3 }),
        baseValue: Math.round(accumulated * currentPriceTl * 100),
        grownValue: Math.round(grown * 100),
      }
    })

    return {
      totalAccumulated,
      valueAtCurrentPrice: Math.round(valueAtCurrentPrice * 100),
      valueWithGrowth: Math.round(valueWithGrowth * 100),
      totalSpent: Math.round(totalSpent * 100),
      profit: Math.round(profit * 100),
      profitPct: totalSpent > 0 ? (profit / totalSpent) * 100 : 0,
      chartData,
      periodLabel: freq.desc,
      yearToTarget,
      monthlyBreakdown,
      totalGrams,
      hasKg: totalGrams !== null && totalGrams >= kgInGrams,
      kgCount: totalGrams !== null ? Math.floor(totalGrams / kgInGrams) : 0,
    }
  }, [assetKey, frequency, amount, duration, startAmount, annualGrowth, currentPriceTl])

  const pricePlaceholder = hasLivePrice
    ? livePrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'Fiyat giriniz'

  // Find the peak year for the reference dot
  const peakPoint = result?.chartData[result.chartData.length - 1]

  return (
    <div className="space-y-6">

      {/* Kategori seçici */}
      <div>
        <p className="text-text-tertiary text-xs mb-3 uppercase tracking-wider font-medium">Varlık Seçin</p>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORY_OPTIONS.map(o => {
            const isActive = category === o.key
            return (
              <button
                key={o.key}
                onClick={() => selectCategory(o.key)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-all duration-200
                  ${isActive
                    ? 'bg-primary/15 border-primary/40 text-white shadow-[0_0_0_1px_rgba(99,102,241,0.2)]'
                    : 'bg-white/[0.02] border-white/[0.08] text-text-tertiary hover:border-white/15 hover:text-white'
                  }`}
              >
                <span className="text-lg leading-none">{o.emoji}</span>
                {o.label}
              </button>
            )
          })}
        </div>

        {/* Altın alt-türleri */}
        {category === 'gold' && (
          <div className="mt-3">
            <div className="grid grid-cols-3 gap-2">
              {GOLD_SUBTYPE_KEYS.map(g => {
                const isActive = assetKey === g.key
                const price = prices[g.key]?.price_tl
                return (
                  <button
                    key={g.key}
                    onClick={() => { setAssetKey(g.key); setCustomPrice('') }}
                    className={`py-2 px-2 rounded-lg text-xs transition-all text-left
                      ${isActive ? 'bg-primary/20 text-white ring-1 ring-primary/40' : 'bg-white/5 text-text-tertiary hover:bg-white/8 hover:text-white'}`}
                  >
                    <div className="font-medium">{GOLD_SUBTYPE_LABELS[g.subtype as keyof typeof GOLD_SUBTYPE_LABELS]}</div>
                    {price ? (
                      <div className={`text-[10px] mt-0.5 ${isActive ? 'text-primary/80' : 'text-text-tertiary'}`}>
                        {price.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ₺
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Döviz seçici */}
        {category === 'currency' && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-4 gap-2">
              {CURRENCY_KEYS.map(c => {
                const isActive = assetKey === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => { setAssetKey(c.key); setCustomPrice('') }}
                    className={`py-1.5 rounded-lg text-xs transition-all
                      ${isActive ? 'bg-primary/20 text-white ring-1 ring-primary/40' : 'bg-white/5 text-text-tertiary hover:bg-white/8 hover:text-white'}`}
                  >
                    {c.code}
                  </button>
                )
              })}
            </div>
            <p className="text-text-tertiary text-[11px] pl-0.5">
              {CURRENCY_LABELS[CURRENCY_KEYS.find(c => c.key === assetKey)?.code ?? 'USD']}
            </p>
          </div>
        )}

        {/* Güncel fiyatlar özeti */}
        <div className="mt-3 px-3 py-2.5 bg-white/[0.02] border border-white/[0.06] rounded-xl">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {(() => {
              // Kategoriye göre ilgili fiyatları göster
              let keys: string[] = []
              if (category === 'gold') keys = GOLD_SUBTYPE_KEYS.map(g => g.key)
              else if (category === 'silver') keys = ['silver_gram']
              else if (category === 'platinum') keys = ['platinum']
              else keys = CURRENCY_KEYS.map(c => c.key)
              return keys.map(k => {
                const p = prices[k]?.price_tl
                return (
                  <span key={k} className="text-text-tertiary">
                    {ASSET_KEY_TO_LABEL[k as AssetKey]}: {p ? <span className="text-white font-medium">{p.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span> : <span className="text-text-tertiary/40">—</span>}
                  </span>
                )
              })
            })()}
          </div>
          <p className="text-text-tertiary/50 text-[10px] mt-1.5">Fiyatları güncellemek için portföy sekmesinden 'Güncelle' butonuna basınız</p>
        </div>
      </div>

      {/* Ana grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">

        {/* Sol — Parametreler */}
        <div className="space-y-4">

          {/* Fiyat */}
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4 space-y-1">
            <div className="flex items-center justify-between mb-2">
              <p className="text-text-secondary text-xs font-medium">{selectedLabel} — Birim Fiyat</p>
              {hasLivePrice && !customPrice && (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md px-1.5 py-0.5">
                  Canlı
                </span>
              )}
              {customPrice && (
                <button
                  onClick={() => setCustomPrice('')}
                  className="text-[10px] text-text-tertiary hover:text-white transition-colors"
                >
                  Canlıya dön
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type="number" min="0" step="any"
                value={customPrice}
                onChange={e => setCustomPrice(e.target.value)}
                placeholder={pricePlaceholder}
                className="w-full bg-background border border-white/[0.1] rounded-xl pl-3 pr-10 py-2.5 text-white text-sm focus:outline-none focus:border-primary/50 placeholder:text-text-tertiary/60"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary text-sm">₺</span>
            </div>
            {hasLivePrice && (
              <p className="text-[11px] text-text-tertiary flex items-center gap-1">
                <Info className="w-3 h-3" />
                Güncel fiyat: {livePrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ — üzerine yazarak özelleştirebilirsiniz
              </p>
            )}
          </div>

          {/* Alım Sıklığı & Miktar */}
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4 space-y-3">
            <p className="text-text-secondary text-xs font-medium">Alım Planı</p>

            <div className="grid grid-cols-3 gap-1.5">
              {FREQUENCY_OPTIONS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFrequency(f.value)}
                  className={`py-2 rounded-lg border text-xs font-medium transition-all duration-200
                    ${frequency === f.value
                      ? 'bg-primary/15 border-primary/40 text-white'
                      : 'border-white/[0.08] text-text-tertiary hover:border-white/15 hover:text-white'
                    }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <input
                type="number" min="0.001" step="any"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Miktar"
                className="w-full bg-background border border-white/[0.1] rounded-xl pl-3 pr-16 py-2.5 text-white text-sm focus:outline-none focus:border-primary/50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary text-xs">birim / {FREQUENCY_OPTIONS.find(f => f.value === frequency)?.label.toLowerCase()}</span>
            </div>
          </div>

          {/* Başlangıç & Süre */}
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4 space-y-3">
            <p className="text-text-secondary text-xs font-medium">Başlangıç & Süre</p>

            <div className="relative">
              <input
                type="number" min="0" step="any"
                value={startAmount}
                onChange={e => setStartAmount(e.target.value)}
                placeholder="Mevcut birikim (opsiyonel)"
                className="w-full bg-background border border-white/[0.1] rounded-xl pl-3 pr-14 py-2.5 text-white text-sm focus:outline-none focus:border-primary/50 placeholder:text-text-tertiary/60"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary text-xs">birim</span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {DURATION_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`py-2 rounded-lg border text-xs font-medium transition-all duration-200
                    ${duration === d
                      ? 'bg-primary/15 border-primary/40 text-white'
                      : 'border-white/[0.08] text-text-tertiary hover:border-white/15 hover:text-white'
                    }`}
                >
                  {d} Yıl
                </button>
              ))}
            </div>
          </div>

          {/* Büyüme oranı */}
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-text-secondary text-xs font-medium">Tahmini Yıllık Değer Artışı</p>
              <span className="text-primary font-bold text-sm">%{annualGrowth || 0}</span>
            </div>
            <input
              type="range" min="0" max="100" step="1"
              value={annualGrowth}
              onChange={e => setAnnualGrowth(e.target.value)}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-text-tertiary">
              <span>%0</span>
              <span>%25</span>
              <span>%50</span>
              <span>%75</span>
              <span>%100</span>
            </div>
          </div>
        </div>

        {/* Sağ — Sonuçlar */}
        <div className="space-y-4">
          {result ? (
            <>
              {/* Özet kartlar */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Toplam Birikim"
                  value={`${result.totalAccumulated.toLocaleString('tr-TR', { maximumFractionDigits: 3 })} birim`}
                  sub={`${duration} yılda • ${FREQUENCY_OPTIONS.find(f => f.value === frequency)?.desc}`}
                />
                <StatCard
                  label="Bugünkü Fiyatla"
                  value={formatTl(result.valueAtCurrentPrice)}
                  sub="Fiyat değişmeseydi"
                />
                <StatCard
                  label={`+%${annualGrowth} Artışla`}
                  value={formatTl(result.valueWithGrowth)}
                  sub="Tahmini gelecek değer"
                  accent="blue"
                />
                <StatCard
                  label="Tahmini Kazanç"
                  value={`${result.profit >= 0 ? '+' : ''}${formatTl(result.profit)}`}
                  sub={`${result.profitPct >= 0 ? '+' : ''}${result.profitPct.toFixed(1)}% getiri`}
                  accent={result.profit >= 0 ? 'green' : 'red'}
                />
              </div>

              {/* Milestone kartlar */}
              {(result.hasKg || result.yearToTarget.some(t => t.years !== null)) && (
                <div className="space-y-2">
                  {result.hasKg && (
                    <MilestoneCard
                      icon={Trophy}
                      label="Birikim hedefi"
                      value={`${result.kgCount} kg ${selectedLabel} birikiyor! 🎉`}
                      color="border-amber-500/20 bg-amber-500/5"
                    />
                  )}
                  {result.yearToTarget[0].years !== null && (
                    <MilestoneCard
                      icon={Target}
                      label="100.000 ₺'ye ulaşma"
                      value={`${result.yearToTarget[0].years}. yılda hedef aşılıyor`}
                      color="border-primary/20 bg-primary/5"
                    />
                  )}
                  {result.yearToTarget[2].years !== null && (
                    <MilestoneCard
                      icon={Zap}
                      label="1.000.000 ₺'ye ulaşma"
                      value={`${result.yearToTarget[2].years}. yılda milyon aşılıyor 🚀`}
                      color="border-emerald-500/20 bg-emerald-500/5"
                    />
                  )}
                </div>
              )}

              {/* Özet satır */}
              <div className="flex items-center gap-2 flex-wrap px-1">
                <span className="text-text-tertiary text-xs">Toplam maliyet:</span>
                <span className="text-white text-xs font-medium">{formatTl(result.totalSpent)}</span>
                <span className="text-white/20 text-xs">•</span>
                {result.profit >= 0 ? (
                  <span className="flex items-center gap-1 text-emerald-400 text-xs">
                    <TrendingUp className="w-3 h-3" /> Kârlı senaryo
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-400 text-xs">
                    <TrendingDown className="w-3 h-3" /> Zararlı senaryo
                  </span>
                )}
              </div>

              {/* Gelişmiş Grafik */}
              {result.chartData.length > 1 && (
                <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary" />
                      <p className="text-text-secondary text-xs font-medium">Değer Projeksiyonu</p>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                        <div className="w-3 h-0.5 bg-primary rounded-full" />
                        Sabit fiyat
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                        <div className="w-3 h-0.5 bg-emerald-400 rounded-full" />
                        +%{annualGrowth} artış
                      </div>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={result.chartData} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="grownGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                      </defs>

                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />

                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#6b7280', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        hide
                        domain={['auto', 'auto']}
                      />
                      <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />

                      {/* Milestone reference lines */}
                      {[100_000_00, 500_000_00, 1_000_000_00].map(target => {
                        const hit = result.chartData.find(d => d.grownValue >= target)
                        if (!hit || hit.year === 0) return null
                        return (
                          <ReferenceLine
                            key={target}
                            x={hit.label}
                            stroke="rgba(251,191,36,0.3)"
                            strokeDasharray="4 4"
                            label={{
                              value: target === 1_000_000_00 ? '1M ₺' : target === 500_000_00 ? '500K ₺' : '100K ₺',
                              fill: '#fbbf24',
                              fontSize: 9,
                              position: 'top',
                            }}
                          />
                        )
                      })}

                      <Area
                        type="monotone"
                        dataKey="baseValue"
                        stroke="#6366f1"
                        strokeWidth={2}
                        fill="url(#baseGrad)"
                        dot={false}
                        activeDot={{ r: 4, fill: '#6366f1', strokeWidth: 0 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="grownValue"
                        stroke="#34d399"
                        strokeWidth={2.5}
                        fill="url(#grownGrad)"
                        dot={false}
                        activeDot={{ r: 4, fill: '#34d399', strokeWidth: 0 }}
                      />

                      {/* Peak dot on grown line */}
                      {peakPoint && (
                        <ReferenceDot
                          x={peakPoint.label}
                          y={peakPoint.grownValue}
                          r={5}
                          fill="#34d399"
                          stroke="#1a2e1a"
                          strokeWidth={2}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>

                  {/* Fark vurgusu */}
                  {parseInt(annualGrowth) > 0 && (
                    <div className="mt-3 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                      <span className="text-[11px] text-text-tertiary">%{annualGrowth} artış senaryosu,</span>
                      <span className="text-[11px] text-emerald-400 font-semibold">
                        +{formatTl(result.valueWithGrowth - result.valueAtCurrentPrice)} ekstra kazandırıyor
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Aylık breakdown tablosu — sadece 1 yıl seçiliyse */}
              {duration === 1 && result.monthlyBreakdown.length > 0 && (
                <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4">
                  <p className="text-text-secondary text-xs font-medium mb-3">Aylık Tablo</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-text-tertiary/70 border-b border-white/5">
                          <th className="text-left pb-2 font-medium">Ay</th>
                          <th className="text-right pb-2 font-medium">Birikim</th>
                          <th className="text-right pb-2 font-medium">Sabit Değer</th>
                          <th className="text-right pb-2 font-medium text-emerald-400/70">+%{annualGrowth}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.03]">
                        {result.monthlyBreakdown.map(row => (
                          <tr key={row.month} className="text-text-secondary hover:bg-white/[0.02] transition-colors">
                            <td className="py-1.5 text-text-tertiary">{row.month}. ay</td>
                            <td className="py-1.5 text-right">{row.accumulated} birim</td>
                            <td className="py-1.5 text-right">{formatTl(row.baseValue)}</td>
                            <td className="py-1.5 text-right text-emerald-400">{formatTl(row.grownValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Disclaimer */}
              <p className="text-text-tertiary/50 text-[10px] text-center px-4">
                Bu hesaplama yalnızca tahmini projeksiyon içermektedir. Geçmiş performans gelecek sonuçların garantisi değildir.
              </p>
            </>
          ) : (
            <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[280px]">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-primary/60" />
              </div>
              <div>
                <p className="text-text-secondary text-sm font-medium">Simülasyonu Başlat</p>
                <p className="text-text-tertiary text-xs mt-1">
                  {!currentPriceTl
                    ? 'Fiyatları güncelleyin veya manuel fiyat girin'
                    : 'Alım miktarını girerek başlayın'
                  }
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
