import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, TrendingUp, TrendingDown, RefreshCw, Coins, X, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Portal } from '../../../components/Portal'
import { useAuth } from '../../../contexts/AuthContext'
import {
  getHoldings, createHolding, updateHolding, deleteHolding,
  fetchAssetPrices, enrichHolding,
  formatTl, kurusToTl, tlToKurus,
  ASSET_LABELS, GOLD_SUBTYPE_LABELS,
  type AssetHolding, type AssetHoldingEnriched, type AssetPrices,
  type AssetType, type GoldSubtype,
} from '../services/assets.service'
import { AssetCalculator } from './AssetCalculator'

// ── Form state ────────────────────────────────────────────────
interface FormState {
  type: AssetType
  subtype: GoldSubtype
  currency_code: string
  quantity: string
  purchase_price: string
  purchase_date: string
  label: string
  note: string
}

const DEFAULT_FORM: FormState = {
  type: 'gold',
  subtype: 'gram',
  currency_code: 'USD',
  quantity: '',
  purchase_price: '',
  purchase_date: new Date().toISOString().slice(0, 10),
  label: '',
  note: '',
}

const TYPE_OPTIONS: { value: AssetType; label: string; emoji: string }[] = [
  { value: 'gold',     label: 'Altın',   emoji: '🥇' },
  { value: 'silver',   label: 'Gümüş',   emoji: '🥈' },
  { value: 'platinum', label: 'Platin',  emoji: '🔵' },
  { value: 'currency', label: 'Döviz',   emoji: '💵' },
]

const GOLD_SUBTYPES: GoldSubtype[] = ['gram', 'quarter', 'half', 'full', 'ata', 'republic']
const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'CHF']

// ── Yardımcı ─────────────────────────────────────────────────
function assetLabel(h: AssetHolding): string {
  if (h.type === 'gold' && h.subtype) return ASSET_LABELS[`gold_${h.subtype}`] ?? 'Altın'
  if (h.type === 'silver') return 'Gram Gümüş'
  if (h.type === 'platinum') return 'Platin'
  if (h.type === 'currency') return h.currency_code ?? 'Döviz'
  return 'Varlık'
}

function assetEmoji(type: AssetType): string {
  return TYPE_OPTIONS.find(t => t.value === type)?.emoji ?? '💰'
}

// ══════════════════════════════════════════════════════════════
export function AssetsSection() {
  const { user } = useAuth()
  const [holdings, setHoldings] = useState<AssetHolding[]>([])
  const [prices, setPrices] = useState<AssetPrices>({})
  const [loading, setLoading] = useState(true)
  const [pricesLoading, setPricesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'portfolio' | 'calculator'>('portfolio')

  // Form
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [submitting, setSubmitting] = useState(false)

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadHoldings = useCallback(async () => {
    if (!user) return
    try {
      const data = await getHoldings(user.id)
      setHoldings(data)
    } catch (e: any) {
      setError(e.message)
    }
  }, [user])

  const loadPrices = useCallback(async (force = false) => {
    setPricesLoading(true)
    try {
      const data = await fetchAssetPrices(force)
      setPrices(data)
    } catch (e: any) {
      setError('Fiyatlar alınamadı: ' + e.message)
    } finally {
      setPricesLoading(false)
    }
  }, [])

  useEffect(() => {
    async function init() {
      setLoading(true)
      await Promise.all([loadHoldings(), loadPrices()])
      setLoading(false)
    }
    init()
  }, [loadHoldings, loadPrices])

  // Enriched holdings
  const enriched: AssetHoldingEnriched[] = holdings.map(h => enrichHolding(h, prices))

  // Portföy toplamları
  const totalCurrentTry = enriched.reduce((s, h) => s + h.current_value_try, 0)
  const totalPurchaseTry = enriched.reduce((s, h) => s + h.purchase_value_try, 0)
  const totalProfitTry = totalCurrentTry - totalPurchaseTry
  const totalProfitPct = totalPurchaseTry === 0 ? 0 : (totalProfitTry / totalPurchaseTry) * 100

  // ── Form handlers ─────────────────────────────────────────
  function openCreate() {
    setForm(DEFAULT_FORM)
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(h: AssetHolding) {
    setForm({
      type: h.type,
      subtype: h.subtype ?? 'gram',
      currency_code: h.currency_code ?? 'USD',
      quantity: String(h.quantity),
      purchase_price: String(kurusToTl(h.purchase_price)),
      purchase_date: h.purchase_date,
      label: h.label ?? '',
      note: h.note ?? '',
    })
    setEditingId(h.id)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(DEFAULT_FORM)
  }

  async function handleSubmit() {
    if (!user) return
    const qty = parseFloat(form.quantity)
    const price = parseFloat(form.purchase_price)
    if (!qty || qty <= 0 || !price || price <= 0) return

    setSubmitting(true)
    try {
      const payload = {
        type: form.type,
        subtype: form.type === 'gold' ? form.subtype : null,
        currency_code: form.type === 'currency' ? form.currency_code : null,
        quantity: qty,
        purchase_price: tlToKurus(price),
        purchase_date: form.purchase_date,
        label: form.label || null,
        note: form.note || null,
      }

      if (editingId) {
        const updated = await updateHolding(editingId, payload)
        setHoldings(prev => prev.map(h => h.id === editingId ? updated : h))
      } else {
        const created = await createHolding(user.id, payload)
        setHoldings(prev => [created, ...prev])
      }
      closeForm()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteHolding(id)
      setHoldings(prev => prev.filter(h => h.id !== id))
      setDeletingId(null)
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-tertiary">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Yükleniyor…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center gap-2 px-4 py-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm"
        >
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
        </motion.div>
      )}

      {/* View toggle */}
      <div className="flex gap-1 p-1 bg-background-elevated/50 border border-white/5 rounded-xl w-fit">
        {(['portfolio', 'calculator'] as const).map(v => (
          <button
            key={v}
            onClick={() => setActiveView(v)}
            className={`relative px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
              ${activeView === v ? 'text-white' : 'text-text-tertiary hover:text-text-primary'}`}
          >
            {activeView === v && (
              <motion.div layoutId="assetViewBg" className="absolute inset-0 bg-primary/20 border border-primary/20 rounded-lg" transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }} />
            )}
            <span className="relative z-10">{v === 'portfolio' ? 'Portföy' : 'Hesap Makinesi'}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeView === 'portfolio' ? (
          <motion.div key="portfolio" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2 }} className="space-y-5">

            {/* Özet kartı */}
            {enriched.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-background-elevated border border-white/5 rounded-2xl p-4">
                  <p className="text-text-tertiary text-xs mb-1">Toplam Değer</p>
                  <p className="text-white font-semibold text-lg">{formatTl(totalCurrentTry)}</p>
                </div>
                <div className="bg-background-elevated border border-white/5 rounded-2xl p-4">
                  <p className="text-text-tertiary text-xs mb-1">Toplam Maliyet</p>
                  <p className="text-white font-semibold text-lg">{formatTl(totalPurchaseTry)}</p>
                </div>
                <div className={`border rounded-2xl p-4 ${totalProfitTry >= 0 ? 'bg-success/10 border-success/20' : 'bg-danger/10 border-danger/20'}`}>
                  <p className="text-text-tertiary text-xs mb-1">Kar / Zarar</p>
                  <p className={`font-semibold text-lg ${totalProfitTry >= 0 ? 'text-success' : 'text-danger'}`}>
                    {totalProfitTry >= 0 ? '+' : ''}{formatTl(totalProfitTry)}
                  </p>
                  <p className={`text-xs ${totalProfitTry >= 0 ? 'text-success' : 'text-danger'}`}>
                    {totalProfitPct >= 0 ? '+' : ''}{totalProfitPct.toFixed(2)}%
                  </p>
                </div>
              </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-text-primary font-semibold">Varlıklarım</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => loadPrices(true)}
                  disabled={pricesLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-white border border-white/10 hover:border-white/20 transition-all"
                >
                  <RefreshCw className={`w-3 h-3 ${pricesLoading ? 'animate-spin' : ''}`} />
                  Fiyatları Güncelle
                </button>
                <button
                  onClick={openCreate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white bg-primary/80 hover:bg-primary border border-primary/30 transition-all"
                >
                  <Plus className="w-3 h-3" />
                  Varlık Ekle
                </button>
              </div>
            </div>

            {/* Liste */}
            {enriched.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Coins className="w-12 h-12 text-text-tertiary mb-3 opacity-40" />
                <p className="text-text-secondary text-sm">Henüz varlık eklemediniz.</p>
                <p className="text-text-tertiary text-xs mt-1">Altın, gümüş veya döviz ekleyerek portföyünüzü oluşturun.</p>
                <button onClick={openCreate} className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-white bg-primary/80 hover:bg-primary transition-all">
                  <Plus className="w-4 h-4" /> Varlık Ekle
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {enriched.map((h) => (
                    <motion.div
                      key={h.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      className="bg-background-elevated border border-white/5 rounded-2xl p-4 hover:border-white/10 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        {/* Emoji */}
                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-xl flex-shrink-0">
                          {assetEmoji(h.type)}
                        </div>

                        {/* Bilgi */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white font-medium text-sm">{h.label || assetLabel(h)}</span>
                            {h.label && <span className="text-text-tertiary text-xs">{assetLabel(h)}</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                            <span className="text-text-tertiary text-xs">{h.quantity} birim</span>
                            <span className="text-text-tertiary text-xs">Alış: {formatTl(h.purchase_price)}/birim</span>
                            <span className="text-text-tertiary text-xs">{h.purchase_date}</span>
                          </div>
                          {h.note && <p className="text-text-tertiary text-xs mt-1 italic truncate">{h.note}</p>}
                        </div>

                        {/* Değerler */}
                        <div className="text-right flex-shrink-0">
                          <p className="text-white font-semibold text-sm">{formatTl(h.current_value_try)}</p>
                          <div className={`flex items-center justify-end gap-1 text-xs mt-0.5 ${h.profit_loss_try >= 0 ? 'text-success' : 'text-danger'}`}>
                            {h.profit_loss_try >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {h.profit_loss_try >= 0 ? '+' : ''}{formatTl(h.profit_loss_try)}
                            <span className="opacity-70">({h.profit_loss_pct >= 0 ? '+' : ''}{h.profit_loss_pct.toFixed(2)}%)</span>
                          </div>
                          <p className="text-text-tertiary text-[10px] mt-0.5">Güncel: {formatTl(h.current_price_try)}/birim</p>
                        </div>

                        {/* Aksiyonlar */}
                        <div className="flex items-center gap-1 ml-1">
                          <button onClick={() => openEdit(h)} className="p-1.5 rounded-lg text-text-tertiary hover:text-white hover:bg-white/5 transition-all">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {deletingId === h.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleDelete(h.id)} className="p-1.5 rounded-lg text-danger hover:bg-danger/10 transition-all">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setDeletingId(null)} className="p-1.5 rounded-lg text-text-tertiary hover:text-white hover:bg-white/5 transition-all">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setDeletingId(h.id)} className="p-1.5 rounded-lg text-text-tertiary hover:text-danger hover:bg-danger/10 transition-all">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="calculator" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2 }}>
            <AssetCalculator prices={prices} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form Modal */}
      <AnimatePresence>
        {showForm && (
          <Portal>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={(e) => e.target === e.currentTarget && closeForm()}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background-elevated border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
              >
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-white font-semibold">{editingId ? 'Varlığı Düzenle' : 'Varlık Ekle'}</h3>
                  <button onClick={closeForm} className="text-text-tertiary hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Tür */}
                  <div>
                    <label className="text-text-secondary text-xs mb-2 block">Varlık Türü</label>
                    <div className="grid grid-cols-4 gap-2">
                      {TYPE_OPTIONS.map(o => (
                        <button
                          key={o.value}
                          onClick={() => setForm(f => ({ ...f, type: o.value }))}
                          className={`flex flex-col items-center gap-1 py-2 rounded-xl border text-xs transition-all
                            ${form.type === o.value ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 text-text-tertiary hover:border-white/20 hover:text-white'}`}
                        >
                          <span className="text-lg">{o.emoji}</span>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Altın alt tipi */}
                  {form.type === 'gold' && (
                    <div>
                      <label className="text-text-secondary text-xs mb-2 block">Altın Tipi</label>
                      <div className="grid grid-cols-3 gap-2">
                        {GOLD_SUBTYPES.map(s => (
                          <button
                            key={s}
                            onClick={() => setForm(f => ({ ...f, subtype: s }))}
                            className={`py-1.5 rounded-lg border text-xs transition-all
                              ${form.subtype === s ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 text-text-tertiary hover:border-white/20 hover:text-white'}`}
                          >
                            {GOLD_SUBTYPE_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Döviz kodu */}
                  {form.type === 'currency' && (
                    <div>
                      <label className="text-text-secondary text-xs mb-2 block">Para Birimi</label>
                      <div className="grid grid-cols-4 gap-2">
                        {CURRENCY_CODES.map(c => (
                          <button
                            key={c}
                            onClick={() => setForm(f => ({ ...f, currency_code: c }))}
                            className={`py-1.5 rounded-lg border text-xs transition-all
                              ${form.currency_code === c ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 text-text-tertiary hover:border-white/20 hover:text-white'}`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Miktar & Alış Fiyatı */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-text-secondary text-xs mb-1.5 block">
                        Miktar {form.type !== 'currency' ? '(gram/adet)' : '(birim)'}
                      </label>
                      <input
                        type="number" min="0" step="any"
                        value={form.quantity}
                        onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                        placeholder="0"
                        className="w-full bg-background border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-text-secondary text-xs mb-1.5 block">Alış Fiyatı (₺/birim)</label>
                      <input
                        type="number" min="0" step="any"
                        value={form.purchase_price}
                        onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))}
                        placeholder="0,00"
                        className="w-full bg-background border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50"
                      />
                    </div>
                  </div>

                  {/* Tarih */}
                  <div>
                    <label className="text-text-secondary text-xs mb-1.5 block">Alış Tarihi</label>
                    <input
                      type="date"
                      value={form.purchase_date}
                      onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                      className="w-full bg-background border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>

                  {/* Etiket */}
                  <div>
                    <label className="text-text-secondary text-xs mb-1.5 block">Etiket (isteğe bağlı)</label>
                    <input
                      type="text"
                      value={form.label}
                      onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                      placeholder="ör. Düğün altınları"
                      className="w-full bg-background border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>

                  {/* Not */}
                  <div>
                    <label className="text-text-secondary text-xs mb-1.5 block">Not (isteğe bağlı)</label>
                    <textarea
                      value={form.note}
                      onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                      placeholder="Notunuz…"
                      rows={2}
                      className="w-full bg-background border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/50 resize-none"
                    />
                  </div>

                  {/* Buttons */}
                  <div className="flex gap-2 pt-1">
                    <button onClick={closeForm} className="flex-1 py-2 rounded-xl border border-white/10 text-text-secondary hover:text-white text-sm transition-all">
                      İptal
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || !form.quantity || !form.purchase_price}
                      className="flex-1 py-2 rounded-xl bg-primary/80 hover:bg-primary text-white text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {submitting ? 'Kaydediliyor…' : editingId ? 'Güncelle' : 'Ekle'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </Portal>
        )}
      </AnimatePresence>
    </div>
  )
}
