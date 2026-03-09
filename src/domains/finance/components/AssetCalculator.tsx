import { useState, useMemo } from 'react'
import { Calculator, TrendingUp } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { formatTl, type AssetPrices } from '../services/assets.service'

// ── Types ─────────────────────────────────────────────────────
type AssetKey = 'gold_gram' | 'gold_quarter' | 'gold_half' | 'gold_full' | 'gold_ata' | 'gold_republic' | 'silver_gram'
type Frequency = 'daily' | 'weekly' | 'monthly'
type Duration = 1 | 3 | 5 | 10

interface Props {
  prices: AssetPrices
}

const ASSET_OPTIONS: { key: AssetKey; label: string; emoji: string }[] = [
  { key: 'gold_gram',     label: 'Gram Altın',       emoji: '🥇' },
  { key: 'gold_quarter',  label: 'Çeyrek Altın',     emoji: '🥇' },
  { key: 'gold_half',     label: 'Yarım Altın',      emoji: '🥇' },
  { key: 'gold_full',     label: 'Tam Altın',        emoji: '🥇' },
  { key: 'gold_ata',      label: 'Ata Altın',        emoji: '🥇' },
  { key: 'gold_republic', label: 'Cumhuriyet Altını', emoji: '🥇' },
  { key: 'silver_gram',   label: 'Gram Gümüş',       emoji: '🥈' },
]

const FREQUENCY_OPTIONS: { value: Frequency; label: string; perYear: number }[] = [
  { value: 'daily',   label: 'Her Gün',    perYear: 365 },
  { value: 'weekly',  label: 'Her Hafta',  perYear: 52  },
  { value: 'monthly', label: 'Her Ay',     perYear: 12  },
]

const DURATION_OPTIONS: Duration[] = [1, 3, 5, 10]

// ── Özel Tooltip ──────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-background-elevated border border-white/10 rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-text-tertiary mb-1">{label}</p>
      <p className="text-white font-medium">{formatTl(payload[0]?.value ?? 0)}</p>
      {payload[1] && <p className="text-primary/80">{formatTl(payload[1]?.value ?? 0)} (değer artışlı)</p>}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
export function AssetCalculator({ prices }: Props) {
  const [assetKey, setAssetKey] = useState<AssetKey>('silver_gram')
  const [frequency, setFrequency] = useState<Frequency>('monthly')
  const [amount, setAmount] = useState('1')
  const [duration, setDuration] = useState<Duration>(1)
  const [startAmount, setStartAmount] = useState('0')
  const [annualGrowth, setAnnualGrowth] = useState('8')
  const [customPrice, setCustomPrice] = useState('')

  // Güncel fiyat (TL)
  const currentPriceTl = useMemo(() => {
    if (customPrice && parseFloat(customPrice) > 0) return parseFloat(customPrice)
    return (prices[assetKey]?.price_tl ?? 0)
  }, [prices, assetKey, customPrice])

  // Hesaplama
  const result = useMemo(() => {
    const qty = parseFloat(amount) || 0
    const start = parseFloat(startAmount) || 0
    const growth = parseFloat(annualGrowth) || 0
    const freq = FREQUENCY_OPTIONS.find(f => f.value === frequency)!
    const totalYears = duration
    const periodsPerYear = freq.perYear
    const totalPeriods = periodsPerYear * totalYears

    if (qty <= 0 || currentPriceTl <= 0) return null

    // Her periyotta eklenen miktar
    const totalAccumulated = start + qty * totalPeriods

    // Bugünkü fiyatla değer
    const valueAtCurrentPrice = totalAccumulated * currentPriceTl

    // Yıllık büyüme varsayımıyla değer (bileşik faiz)
    const growthRate = growth / 100
    let valueWithGrowth = start * currentPriceTl * Math.pow(1 + growthRate, totalYears)
    // Her periyotta alınan varlığın bileşik artışlı değeri
    for (let p = 1; p <= totalPeriods; p++) {
      const yearsRemaining = (totalPeriods - p) / periodsPerYear
      const futurePrice = currentPriceTl * Math.pow(1 + growthRate, yearsRemaining)
      valueWithGrowth += qty * futurePrice
    }

    // Toplam ödenen para (TL)
    const totalSpent = (start + qty * totalPeriods) * currentPriceTl

    // Grafik datası — yıllık
    const chartData = Array.from({ length: totalYears + 1 }, (_, i) => {
      const label = i === 0 ? 'Başlangıç' : `${i}. Yıl`
      const accumulated = start + qty * periodsPerYear * i
      const baseValue = Math.round(accumulated * currentPriceTl * 100)
      const grownValue = Math.round(
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
      profit: Math.round((valueWithGrowth - totalSpent) * 100),
      chartData,
    }
  }, [assetKey, frequency, amount, duration, startAmount, annualGrowth, currentPriceTl])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Calculator className="w-5 h-5 text-primary" />
        <h3 className="text-white font-semibold">Birikim Simülatörü</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Sol — Parametreler */}
        <div className="space-y-4">

          {/* Varlık seçimi */}
          <div>
            <label className="text-text-secondary text-xs mb-2 block">Varlık</label>
            <div className="grid grid-cols-2 gap-2">
              {ASSET_OPTIONS.map(o => (
                <button
                  key={o.key}
                  onClick={() => { setAssetKey(o.key); setCustomPrice('') }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-all text-left
                    ${assetKey === o.key ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 text-text-tertiary hover:border-white/20 hover:text-white'}`}
                >
                  <span>{o.emoji}</span>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Fiyat */}
          <div>
            <label className="text-text-secondary text-xs mb-1.5 block">
              Birim Fiyat (₺)
              {currentPriceTl > 0 && !customPrice && (
                <span className="text-text-tertiary ml-1">— Otomatik: {currentPriceTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
              )}
            </label>
            <input
              type="number" min="0" step="any"
              value={customPrice}
              onChange={e => setCustomPrice(e.target.value)}
              placeholder={currentPriceTl > 0 ? `${currentPriceTl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (güncel fiyat)` : 'Fiyat girin'}
              className="w-full bg-background border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50"
            />
          </div>

          {/* Sıklık */}
          <div>
            <label className="text-text-secondary text-xs mb-2 block">Alım Sıklığı</label>
            <div className="grid grid-cols-3 gap-2">
              {FREQUENCY_OPTIONS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFrequency(f.value)}
                  className={`py-1.5 rounded-xl border text-xs transition-all
                    ${frequency === f.value ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 text-text-tertiary hover:border-white/20 hover:text-white'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Miktar */}
          <div>
            <label className="text-text-secondary text-xs mb-1.5 block">Her Alımda Miktar (birim)</label>
            <input
              type="number" min="0.001" step="any"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full bg-background border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50"
            />
          </div>

          {/* Başlangıç */}
          <div>
            <label className="text-text-secondary text-xs mb-1.5 block">Başlangıç Birikimi (birim)</label>
            <input
              type="number" min="0" step="any"
              value={startAmount}
              onChange={e => setStartAmount(e.target.value)}
              placeholder="0"
              className="w-full bg-background border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50"
            />
          </div>

          {/* Süre */}
          <div>
            <label className="text-text-secondary text-xs mb-2 block">Süre</label>
            <div className="grid grid-cols-4 gap-2">
              {DURATION_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`py-1.5 rounded-xl border text-xs transition-all
                    ${duration === d ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 text-text-tertiary hover:border-white/20 hover:text-white'}`}
                >
                  {d} Yıl
                </button>
              ))}
            </div>
          </div>

          {/* Büyüme */}
          <div>
            <label className="text-text-secondary text-xs mb-1.5 block">
              Tahmini Yıllık Değer Artışı (%)
            </label>
            <input
              type="number" min="0" max="200" step="0.5"
              value={annualGrowth}
              onChange={e => setAnnualGrowth(e.target.value)}
              className="w-full bg-background border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        {/* Sağ — Sonuç */}
        <div className="space-y-4">
          {result ? (
            <>
              {/* Özet kartlar */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-elevated border border-white/5 rounded-2xl p-4">
                  <p className="text-text-tertiary text-xs mb-1">Toplam Birikim</p>
                  <p className="text-white font-bold text-lg">{result.totalAccumulated.toLocaleString('tr-TR', { maximumFractionDigits: 3 })} birim</p>
                </div>
                <div className="bg-background-elevated border border-white/5 rounded-2xl p-4">
                  <p className="text-text-tertiary text-xs mb-1">Bugünkü Fiyatla</p>
                  <p className="text-white font-bold text-lg">{formatTl(result.valueAtCurrentPrice)}</p>
                </div>
                <div className="bg-primary/10 border border-primary/20 rounded-2xl p-4">
                  <p className="text-text-tertiary text-xs mb-1">+%{annualGrowth} Artışla</p>
                  <p className="text-primary font-bold text-lg">{formatTl(result.valueWithGrowth)}</p>
                </div>
                <div className={`border rounded-2xl p-4 ${result.profit >= 0 ? 'bg-success/10 border-success/20' : 'bg-danger/10 border-danger/20'}`}>
                  <p className="text-text-tertiary text-xs mb-1">Tahmini Kazanç</p>
                  <p className={`font-bold text-lg ${result.profit >= 0 ? 'text-success' : 'text-danger'}`}>
                    {result.profit >= 0 ? '+' : ''}{formatTl(result.profit)}
                  </p>
                </div>
              </div>

              <div className="bg-background-elevated border border-white/5 rounded-2xl p-4 text-xs text-text-tertiary">
                Toplam Ödenen: <span className="text-white">{formatTl(result.totalSpent)}</span>
                {' · '}
                Süre: <span className="text-white">{duration} yıl</span>
                {' · '}
                Sıklık: <span className="text-white">{FREQUENCY_OPTIONS.find(f => f.value === frequency)?.label}</span>
              </div>

              {/* Grafik */}
              {result.chartData.length > 1 && (
                <div className="bg-background-elevated border border-white/5 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <p className="text-text-secondary text-xs">Yıllık Değer Eğrisi</p>
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={result.chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="grownGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="baseValue" stroke="#6366f1" strokeWidth={2} fill="url(#baseGrad)" name="Bugünkü Fiyatla" />
                      <Area type="monotone" dataKey="grownValue" stroke="#10b981" strokeWidth={2} fill="url(#grownGrad)" name="Değer Artışlı" />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 mt-2 justify-center">
                    <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                      <div className="w-3 h-0.5 bg-primary rounded" /> Bugünkü fiyatla
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                      <div className="w-3 h-0.5 bg-success rounded" /> +%{annualGrowth} artışla
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center text-text-tertiary">
              <Calculator className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Parametreleri doldurun</p>
              <p className="text-xs mt-1 opacity-70">Miktar ve fiyat girilince sonuçlar görünür</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
