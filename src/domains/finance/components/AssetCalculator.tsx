import { useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, Info } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatTl, type AssetPrices } from '../services/assets.service'

type AssetKey = 'gold_gram' | 'gold_quarter' | 'gold_half' | 'gold_full' | 'gold_ata' | 'gold_republic' | 'silver_gram'
type Frequency = 'daily' | 'weekly' | 'monthly'
type Duration = 1 | 3 | 5 | 10

interface Props {
  prices: AssetPrices
}

const ASSET_OPTIONS: { key: AssetKey; label: string; shortLabel: string; emoji: string }[] = [
  { key: 'gold_gram',     label: 'Gram Altın',        shortLabel: 'Gram',        emoji: '🥇' },
  { key: 'gold_quarter',  label: 'Çeyrek Altın',      shortLabel: 'Çeyrek',      emoji: '🥇' },
  { key: 'gold_half',     label: 'Yarım Altın',       shortLabel: 'Yarım',       emoji: '🥇' },
  { key: 'gold_full',     label: 'Tam Altın',         shortLabel: 'Tam',         emoji: '🥇' },
  { key: 'gold_ata',      label: 'Ata Altın',         shortLabel: 'Ata',         emoji: '🥇' },
  { key: 'gold_republic', label: 'Cumhuriyet Altını', shortLabel: 'Cumhuriyet',  emoji: '🥇' },
  { key: 'silver_gram',   label: 'Gram Gümüş',        shortLabel: 'Gümüş',       emoji: '🥈' },
]

const FREQUENCY_OPTIONS: { value: Frequency; label: string; perYear: number; desc: string }[] = [
  { value: 'daily',   label: 'Günlük',  perYear: 365, desc: 'Her gün' },
  { value: 'weekly',  label: 'Haftalık', perYear: 52,  desc: 'Her hafta' },
  { value: 'monthly', label: 'Aylık',   perYear: 12,  desc: 'Her ay' },
]

const DURATION_OPTIONS: Duration[] = [1, 3, 5, 10]

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1a1a2e] border border-white/10 rounded-xl px-3 py-2.5 text-xs shadow-2xl min-w-[160px]">
      <p className="text-text-tertiary mb-2 font-medium">{label}</p>
      <div className="space-y-1">
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
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'blue' | 'green' | 'red' | 'none' }) {
  const colors = {
    blue:  'bg-primary/10 border-primary/20',
    green: 'bg-emerald-500/10 border-emerald-500/20',
    red:   'bg-red-500/10 border-red-500/20',
    none:  'bg-white/[0.03] border-white/5',
  }
  const textColors = {
    blue:  'text-primary',
    green: 'text-emerald-400',
    red:   'text-red-400',
    none:  'text-white',
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

export function AssetCalculator({ prices }: Props) {
  const [assetKey, setAssetKey] = useState<AssetKey>('silver_gram')
  const [frequency, setFrequency] = useState<Frequency>('monthly')
  const [amount, setAmount] = useState('1')
  const [duration, setDuration] = useState<Duration>(1)
  const [startAmount, setStartAmount] = useState('')
  const [annualGrowth, setAnnualGrowth] = useState('8')
  const [customPrice, setCustomPrice] = useState('')

  const selectedAsset = ASSET_OPTIONS.find(o => o.key === assetKey)!
  const livePrice = prices[assetKey]?.price_tl ?? 0
  const currentPriceTl = customPrice && parseFloat(customPrice) > 0 ? parseFloat(customPrice) : livePrice
  const hasLivePrice = livePrice > 0

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
      return { label, baseValue, grownValue }
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
    }
  }, [assetKey, frequency, amount, duration, startAmount, annualGrowth, currentPriceTl])

  const pricePlaceholder = hasLivePrice
    ? livePrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'Fiyat giriniz'

  return (
    <div className="space-y-6">

      {/* Varlık seçici — horizontal scroll */}
      <div>
        <p className="text-text-tertiary text-xs mb-3 uppercase tracking-wider font-medium">Varlık Seçin</p>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {ASSET_OPTIONS.map(o => {
            const price = prices[o.key]?.price_tl
            const isActive = assetKey === o.key
            return (
              <button
                key={o.key}
                onClick={() => { setAssetKey(o.key); setCustomPrice('') }}
                className={`flex-shrink-0 flex flex-col items-start gap-1 px-3.5 py-2.5 rounded-xl border text-left transition-all duration-200
                  ${isActive
                    ? 'bg-primary/15 border-primary/40 shadow-[0_0_0_1px_rgba(99,102,241,0.2)]'
                    : 'bg-white/[0.02] border-white/8 hover:border-white/15 hover:bg-white/[0.04]'
                  }`}
              >
                <span className="text-base leading-none">{o.emoji}</span>
                <span className={`text-xs font-medium whitespace-nowrap ${isActive ? 'text-white' : 'text-text-secondary'}`}>
                  {o.shortLabel}
                </span>
                {price ? (
                  <span className={`text-[10px] whitespace-nowrap ${isActive ? 'text-primary/80' : 'text-text-tertiary'}`}>
                    {price.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ₺
                  </span>
                ) : (
                  <span className="text-[10px] text-text-tertiary/40">—</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Ana grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6">

        {/* Sol — Parametreler */}
        <div className="space-y-4">

          {/* Fiyat */}
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-4 space-y-1">
            <div className="flex items-center justify-between mb-2">
              <p className="text-text-secondary text-xs font-medium">{selectedAsset.label} — Birim Fiyat</p>
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
                className="w-full bg-background border border-white/10 rounded-xl pl-3 pr-10 py-2.5 text-white text-sm focus:outline-none focus:border-primary/50 placeholder:text-text-tertiary/60"
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
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-4 space-y-3">
            <p className="text-text-secondary text-xs font-medium">Alım Planı</p>

            <div className="grid grid-cols-3 gap-1.5">
              {FREQUENCY_OPTIONS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFrequency(f.value)}
                  className={`py-2 rounded-lg border text-xs font-medium transition-all duration-200
                    ${frequency === f.value
                      ? 'bg-primary/15 border-primary/40 text-white'
                      : 'border-white/8 text-text-tertiary hover:border-white/15 hover:text-white'
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
                className="w-full bg-background border border-white/10 rounded-xl pl-3 pr-16 py-2.5 text-white text-sm focus:outline-none focus:border-primary/50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary text-xs">birim / {FREQUENCY_OPTIONS.find(f => f.value === frequency)?.label.toLowerCase()}</span>
            </div>
          </div>

          {/* Başlangıç & Süre */}
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-4 space-y-3">
            <p className="text-text-secondary text-xs font-medium">Başlangıç & Süre</p>

            <div className="relative">
              <input
                type="number" min="0" step="any"
                value={startAmount}
                onChange={e => setStartAmount(e.target.value)}
                placeholder="Mevcut birikim (opsiyonel)"
                className="w-full bg-background border border-white/10 rounded-xl pl-3 pr-14 py-2.5 text-white text-sm focus:outline-none focus:border-primary/50 placeholder:text-text-tertiary/60"
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
                      : 'border-white/8 text-text-tertiary hover:border-white/15 hover:text-white'
                    }`}
                >
                  {d} Yıl
                </button>
              ))}
            </div>
          </div>

          {/* Büyüme oranı */}
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-4 space-y-3">
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

              {/* Grafik */}
              {result.chartData.length > 1 && (
                <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-4">
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
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={result.chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="grownGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
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
                      <YAxis hide />
                      <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />
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
                        strokeWidth={2}
                        fill="url(#grownGrad)"
                        dot={false}
                        activeDot={{ r: 4, fill: '#34d399', strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Disclaimer */}
              <p className="text-text-tertiary/50 text-[10px] text-center px-4">
                Bu hesaplama yalnızca tahmini projeksiyon içermektedir. Geçmiş performans gelecek sonuçların garantisi değildir.
              </p>
            </>
          ) : (
            <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[280px]">
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
