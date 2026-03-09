// ============================================================
// FINANCE DOMAIN — REACT CONTEXT
// Follows TasksContext pattern: optimistic updates, useToast, useAuth
// No realtime subscription in V1 (single user, deterministic mutations)
// ============================================================

import {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
    useCallback,
    useMemo,
} from 'react'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import type {
    FinanceCategory,
    FinanceTag,
    FinanceTransaction,
    FinanceObligation,
    ObligationWithDerived,
    RecurringTemplate,
    RecurringFrequency,
    TransactionFilters,
    DashboardStats,
    DashboardPeriodConfig,
} from '../domains/finance/types/finance.types'
import { tlToKurus } from '../domains/finance/types/finance.types'
import * as FinanceService from '../domains/finance/services/finance.service'
import { uploadReceipt, deleteReceipt } from '../lib/financeStorage'
import { getSupabaseClient } from '../lib/supabase'

// ──────────────────────────────────────────────
// Context interface
// ──────────────────────────────────────────────

interface FinanceContextType {
    // State
    categories: FinanceCategory[]
    tags: FinanceTag[]
    transactions: FinanceTransaction[]
    obligations: FinanceObligation[]
    recurringTemplates: RecurringTemplate[]
    loading: boolean
    error: string | null

    // Filters
    transactionFilters: TransactionFilters
    setTransactionFilters: (filters: TransactionFilters) => void

    // Dashboard
    getDashboardStats: (config: DashboardPeriodConfig) => Promise<DashboardStats | null>

    // Category mutations
    createCategory: (input: { type: 'income' | 'expense'; name: string; color: string; icon?: string }) => Promise<FinanceCategory | null>
    updateCategory: (id: string, updates: Partial<Pick<FinanceCategory, 'name' | 'color' | 'icon'>>) => Promise<void>
    deleteCategory: (id: string) => Promise<void>

    // Tag mutations
    createTag: (input: { category_id?: string; name: string; color: string }) => Promise<FinanceTag | null>
    deleteTag: (id: string) => Promise<void>

    // Transaction mutations
    createTransaction: (input: {
        type: 'income' | 'expense'
        amountTl: string
        currency?: string
        category_id?: string
        tag_id?: string
        obligation_id?: string
        occurred_at: string
        note?: string
        receiptFile?: File | null
    }) => Promise<FinanceTransaction | null>
    updateTransaction: (id: string, updates: Partial<Pick<FinanceTransaction, 'type' | 'amount' | 'currency' | 'category_id' | 'tag_id' | 'obligation_id' | 'occurred_at' | 'note' | 'receipt_path'>>) => Promise<void>
    updateTransactionWithReceipt: (
        id: string,
        updates: Partial<Pick<FinanceTransaction, 'type' | 'amount' | 'currency' | 'category_id' | 'tag_id' | 'obligation_id' | 'occurred_at' | 'note'>>,
        opts?: { newReceiptFile?: File | null; removeExistingReceipt?: boolean; existingReceiptPath?: string | null }
    ) => Promise<void>
    archiveTransaction: (id: string) => Promise<void>
    deleteTransaction: (id: string, receiptPath?: string | null) => Promise<void>

    // Obligation mutations
    createObligation: (input: {
        type: 'payable' | 'receivable'
        amountTl: string
        currency?: string
        description: string
        counterparty?: string
        start_date?: string
        deadline?: string
        reminder_days?: number
    }) => Promise<FinanceObligation | null>
    updateObligation: (id: string, updates: Partial<Pick<FinanceObligation, 'description' | 'counterparty' | 'deadline' | 'reminder_days' | 'total_amount'>>) => Promise<void>
    closeObligation: (id: string) => Promise<void>
    reopenObligation: (id: string) => Promise<void>
    deleteObligation: (id: string) => Promise<void>
    getObligationDetail: (id: string) => Promise<ObligationWithDerived | null>

    // Recurring template mutations
    createRecurringTemplate: (input: {
        type: 'income' | 'expense'
        amountTl: string
        currency?: string
        category_id?: string
        tag_id?: string
        name: string
        note?: string
        frequency: RecurringFrequency
        next_occurrence: string
        end_date?: string
    }) => Promise<RecurringTemplate | null>
    updateRecurringTemplate: (id: string, updates: Partial<{
        type: 'income' | 'expense'
        amountTl: string
        currency: string
        category_id: string | null
        tag_id: string | null
        name: string
        note: string | null
        frequency: RecurringFrequency
        next_occurrence: string
        end_date: string | null
        is_active: boolean
    }>) => Promise<RecurringTemplate | null>
    generateTransactionFromTemplate: (templateId: string) => Promise<FinanceTransaction | null>
    deleteRecurringTemplate: (id: string) => Promise<void>

    // Tags helper
    getTagsForCategory: (categoryId: string) => FinanceTag[]
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined)

export function useFinance(): FinanceContextType {
    const ctx = useContext(FinanceContext)
    if (!ctx) throw new Error('useFinance must be used within FinanceProvider')
    return ctx
}

// ──────────────────────────────────────────────
// Provider
// ──────────────────────────────────────────────

export function FinanceProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth()
    const { showToast } = useToast()

    const [categories, setCategories] = useState<FinanceCategory[]>([])
    const [tags, setTags] = useState<FinanceTag[]>([])
    const [transactions, setTransactions] = useState<FinanceTransaction[]>([])
    const [obligations, setObligations] = useState<FinanceObligation[]>([])
    const [recurringTemplates, setRecurringTemplates] = useState<RecurringTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [transactionFilters, setTransactionFilters] = useState<TransactionFilters>({
        sortOrder: 'desc',
        type: 'all',
        includeArchived: false,
    })

    // ── Load all finance data ──
    const loadAll = useCallback(async (isSilent = false) => {
        if (!user) return
        if (!isSilent) {
            setLoading(true)
            setError(null)
        }
        try {
            const [cats, tgs, txns, obs, recurrings] = await Promise.all([
                FinanceService.getCategories(user.id),
                FinanceService.getTags(user.id),
                FinanceService.getTransactions(user.id, { sortOrder: 'desc', includeArchived: false }),
                FinanceService.getObligations(user.id),
                FinanceService.getRecurringTemplates(user.id),
            ])
            setCategories(cats)
            setTags(tgs)
            setTransactions(txns)
            setObligations(obs)
            setRecurringTemplates(recurrings)
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Finans verileri yüklenemedi'
            if (!isSilent) {
                setError(msg)
                showToast(msg, 'error')
            } else {
                console.error('[Realtime Refetch Error]', msg)
            }
        } finally {
            if (!isSilent) setLoading(false)
        }
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!user) {
            setCategories([])
            setTags([])
            setTransactions([])
            setObligations([])
            setRecurringTemplates([])
            setLoading(false)
            return
        }
        loadAll(false)
    }, [user, loadAll]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Realtime Subscription ──
    useEffect(() => {
        if (!user?.id) return

        const supabase = getSupabaseClient()
        const channelName = `finance-changes-${user.id}`

        const handleChange = () => {
            // Fetch silently when another tab/device updates the database
            loadAll(true)
        }

        const channel = supabase.channel(channelName)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_transactions', filter: `user_id=eq.${user.id}` }, handleChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_obligations', filter: `user_id=eq.${user.id}` }, handleChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_recurring_templates', filter: `user_id=eq.${user.id}` }, handleChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_categories', filter: `user_id=eq.${user.id}` }, handleChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_tags', filter: `user_id=eq.${user.id}` }, handleChange)
            .subscribe(() => { })

        return () => {
            supabase.removeChannel(channel)
        }
    }, [user?.id, loadAll])

    // ── Filtered transactions (derived, never stored) ──
    const filteredTransactions = useMemo(() => {
        return transactions.filter((t) => {
            if (!transactionFilters.includeArchived && t.is_archived) return false
            if (transactionFilters.type && transactionFilters.type !== 'all' && t.type !== transactionFilters.type) return false
            if (transactionFilters.categoryIds?.length && !transactionFilters.categoryIds.includes(t.category_id || '')) return false
            if (transactionFilters.tagIds?.length && !transactionFilters.tagIds.includes(t.tag_id || '')) return false
            if (transactionFilters.amountMinKurus !== undefined && t.amount < transactionFilters.amountMinKurus) return false
            if (transactionFilters.amountMaxKurus !== undefined && t.amount > transactionFilters.amountMaxKurus) return false
            if (transactionFilters.dateFrom && new Date(t.occurred_at) < new Date(transactionFilters.dateFrom)) return false
            if (transactionFilters.dateTo) {
                const endOfDay = new Date(transactionFilters.dateTo)
                endOfDay.setHours(23, 59, 59, 999)
                if (new Date(t.occurred_at) > endOfDay) return false
            }
            return true
        }).sort((a, b) => {
            const diff = new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
            return transactionFilters.sortOrder === 'asc' ? diff : -diff
        })
    }, [transactions, transactionFilters])

    const getTagsForCategory = useCallback((categoryId: string) => {
        return tags.filter((t) => t.category_id === categoryId)
    }, [tags])

    // ──────────────────────────────────────────────
    // DASHBOARD
    // ──────────────────────────────────────────────

    const getDashboardStats = useCallback(async (config: DashboardPeriodConfig): Promise<DashboardStats | null> => {
        if (!user) return null
        try {
            return await FinanceService.getDashboardStats(user.id, config, categories)
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'İstatistikler yüklenemedi'
            showToast(msg, 'error')
            return null
        }
    }, [user, categories, showToast])

    // ──────────────────────────────────────────────
    // CATEGORIES
    // ──────────────────────────────────────────────

    const createCategory = useCallback(async (input: { type: 'income' | 'expense'; name: string; color: string; icon?: string }): Promise<FinanceCategory | null> => {
        if (!user) return null
        try {
            const cat = await FinanceService.createCategory(user.id, input)
            setCategories((prev) => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))
            showToast('Kategori oluşturuldu', 'success', 2000)
            return cat
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Kategori oluşturulamadı'
            showToast(msg, 'error')
            return null
        }
    }, [user, showToast])

    const updateCategory = useCallback(async (id: string, updates: Partial<Pick<FinanceCategory, 'name' | 'color' | 'icon'>>) => {
        if (!user) return
        const prev = categories.find((c) => c.id === id)
        try {
            const updated = await FinanceService.updateCategory(user.id, id, updates)
            setCategories((cats) => cats.map((c) => c.id === id ? updated : c))
            showToast('Kategori güncellendi', 'success', 2000)
        } catch (err) {
            if (prev) setCategories((cats) => cats.map((c) => c.id === id ? prev : c))
            const msg = err instanceof Error ? err.message : 'Kategori güncellenemedi'
            showToast(msg, 'error')
        }
    }, [user, categories, showToast])

    const deleteCategory = useCallback(async (id: string) => {
        if (!user) return
        setCategories((cats) => cats.filter((c) => c.id !== id))
        try {
            await FinanceService.deleteCategory(user.id, id)
            showToast('Kategori silindi', 'success', 2000)
        } catch (err) {
            // Re-fetch on failure
            FinanceService.getCategories(user.id).then(setCategories).catch(console.error)
            const msg = err instanceof Error ? err.message : 'Kategori silinemedi'
            showToast(msg, 'error')
        }
    }, [user, showToast])

    // ──────────────────────────────────────────────
    // TAGS
    // ──────────────────────────────────────────────

    const createTag = useCallback(async (input: { category_id?: string; name: string; color: string }): Promise<FinanceTag | null> => {
        if (!user) return null
        try {
            const tag = await FinanceService.createTag(user.id, input)
            setTags((prev) => [...prev, tag])
            showToast('Etiket oluşturuldu', 'success', 2000)
            return tag
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Etiket oluşturulamadı'
            showToast(msg, 'error')
            return null
        }
    }, [user, showToast])

    const deleteTag = useCallback(async (id: string) => {
        if (!user) return
        setTags((prev) => prev.filter((t) => t.id !== id))
        try {
            await FinanceService.deleteTag(user.id, id)
            showToast('Etiket silindi', 'success', 2000)
        } catch (err) {
            FinanceService.getTags(user.id).then(setTags).catch(console.error)
            const msg = err instanceof Error ? err.message : 'Etiket silinemedi'
            showToast(msg, 'error')
        }
    }, [user, showToast])

    // ──────────────────────────────────────────────
    // TRANSACTIONS
    // ──────────────────────────────────────────────

    const createTransaction = useCallback(async (input: {
        type: 'income' | 'expense'
        amountTl: string
        currency?: string
        category_id?: string
        tag_id?: string
        obligation_id?: string
        occurred_at: string
        note?: string
        receiptFile?: File | null
    }): Promise<FinanceTransaction | null> => {
        if (!user) return null
        try {
            const amountKurus = tlToKurus(input.amountTl)
            if (amountKurus <= 0) {
                showToast('Geçerli bir tutar girin', 'error')
                return null
            }

            // Upload receipt if provided
            let receipt_path: string | undefined
            if (input.receiptFile) {
                const tempId = `temp-${Date.now()}`
                const { path, error: uploadErr } = await uploadReceipt(input.receiptFile, user.id, tempId)
                if (uploadErr) {
                    showToast(`Fiş yüklenemedi: ${uploadErr}`, 'error')
                } else {
                    receipt_path = path
                }
            }

            const txn = await FinanceService.createTransaction(user.id, {
                type: input.type,
                amount: amountKurus,
                currency: input.currency,
                category_id: input.category_id,
                tag_id: input.tag_id,
                obligation_id: input.obligation_id,
                occurred_at: input.occurred_at,
                note: input.note,
                receipt_path,
            })

            setTransactions((prev) => [txn, ...prev])
            showToast('İşlem oluşturuldu', 'success', 2000)
            return txn
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'İşlem oluşturulamadı'
            showToast(msg, 'error')
            return null
        }
    }, [user, showToast])

    const updateTransaction = useCallback(async (id: string, updates: Partial<Pick<FinanceTransaction, 'type' | 'amount' | 'currency' | 'category_id' | 'tag_id' | 'obligation_id' | 'occurred_at' | 'note' | 'receipt_path'>>) => {
        if (!user) return
        const prev = transactions.find((t) => t.id === id)
        setTransactions((ts) => ts.map((t) => t.id === id ? { ...t, ...updates } : t))
        try {
            const updated = await FinanceService.updateTransaction(user.id, id, updates)
            setTransactions((ts) => ts.map((t) => t.id === id ? updated : t))
            showToast('İşlem güncellendi', 'success', 2000)
        } catch (err) {
            if (prev) setTransactions((ts) => ts.map((t) => t.id === id ? prev : t))
            const msg = err instanceof Error ? err.message : 'İşlem güncellenemedi'
            showToast(msg, 'error')
        }
    }, [user, transactions, showToast])

    const updateTransactionWithReceipt = useCallback(async (
        id: string,
        updates: Partial<Pick<FinanceTransaction, 'type' | 'amount' | 'currency' | 'category_id' | 'tag_id' | 'obligation_id' | 'occurred_at' | 'note'>>,
        opts?: { newReceiptFile?: File | null; removeExistingReceipt?: boolean; existingReceiptPath?: string | null }
    ) => {
        if (!user) return
        const prev = transactions.find((t) => t.id === id)
        try {
            let receiptPath: string | null | undefined = undefined // undefined = don't change

            // Remove old receipt if requested or if replacing
            if (opts?.removeExistingReceipt || opts?.newReceiptFile) {
                if (opts?.existingReceiptPath) {
                    await deleteReceipt(opts.existingReceiptPath)
                }
                receiptPath = null // will be overwritten below if new file exists
            }

            // Upload new receipt if provided
            if (opts?.newReceiptFile) {
                const result = await uploadReceipt(opts.newReceiptFile, user.id, id)
                if (result.error) throw new Error(result.error)
                receiptPath = result.path
            }

            const fullUpdates = {
                ...updates,
                ...(receiptPath !== undefined ? { receipt_path: receiptPath } : {}),
            }

            const updated = await FinanceService.updateTransaction(user.id, id, fullUpdates)
            setTransactions((ts) => ts.map((t) => t.id === id ? updated : t))
            showToast('İşlem güncellendi', 'success', 2000)
        } catch (err) {
            if (prev) setTransactions((ts) => ts.map((t) => t.id === id ? prev : t))
            const msg = err instanceof Error ? err.message : 'İşlem güncellenemedi'
            showToast(msg, 'error')
        }
    }, [user, transactions, showToast])

    const archiveTransaction = useCallback(async (id: string) => {
        if (!user) return
        setTransactions((ts) => ts.map((t) => t.id === id ? { ...t, is_archived: true } : t))
        try {
            await FinanceService.archiveTransaction(user.id, id)
            showToast('İşlem arşivlendi', 'success', 2000)
        } catch (err) {
            setTransactions((ts) => ts.map((t) => t.id === id ? { ...t, is_archived: false } : t))
            const msg = err instanceof Error ? err.message : 'İşlem arşivlenemedi'
            showToast(msg, 'error')
        }
    }, [user, showToast])

    const deleteTransaction = useCallback(async (id: string, receiptPath?: string | null) => {
        if (!user) return
        const snapshot = transactions.find((t) => t.id === id)
        setTransactions((ts) => ts.filter((t) => t.id !== id))
        try {
            await FinanceService.deleteTransaction(user.id, id)
            // Delete receipt from storage if exists
            if (receiptPath) {
                await deleteReceipt(receiptPath)
            }
            showToast('İşlem silindi', 'success', 2000)
        } catch (err) {
            if (snapshot) setTransactions((ts) => [snapshot, ...ts])
            const msg = err instanceof Error ? err.message : 'İşlem silinemedi'
            showToast(msg, 'error')
        }
    }, [user, transactions, showToast])

    // ──────────────────────────────────────────────
    // OBLIGATIONS
    // ──────────────────────────────────────────────

    const createObligation = useCallback(async (input: {
        type: 'payable' | 'receivable'
        amountTl: string
        currency?: string
        description: string
        counterparty?: string
        start_date?: string
        deadline?: string
        reminder_days?: number
    }): Promise<FinanceObligation | null> => {
        if (!user) return null
        try {
            const totalAmount = tlToKurus(input.amountTl)
            if (totalAmount <= 0) {
                showToast('Geçerli bir tutar girin', 'error')
                return null
            }
            const ob = await FinanceService.createObligation(user.id, {
                ...input,
                total_amount: totalAmount,
            })
            setObligations((prev) => [ob, ...prev])
            showToast('Yükümlülük oluşturuldu', 'success', 2000)
            return ob
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Yükümlülük oluşturulamadı'
            showToast(msg, 'error')
            return null
        }
    }, [user, showToast])

    const updateObligation = useCallback(async (id: string, updates: Partial<Pick<FinanceObligation, 'description' | 'counterparty' | 'deadline' | 'reminder_days' | 'total_amount'>>) => {
        if (!user) return
        const prev = obligations.find((o) => o.id === id)
        setObligations((obs) => obs.map((o) => o.id === id ? { ...o, ...updates } : o))
        try {
            const updated = await FinanceService.updateObligation(user.id, id, updates)
            setObligations((obs) => obs.map((o) => o.id === id ? updated : o))
            showToast('Yükümlülük güncellendi', 'success', 2000)
        } catch (err) {
            if (prev) setObligations((obs) => obs.map((o) => o.id === id ? prev : o))
            const msg = err instanceof Error ? err.message : 'Yükümlülük güncellenemedi'
            showToast(msg, 'error')
        }
    }, [user, obligations, showToast])

    const closeObligation = useCallback(async (id: string) => {
        if (!user) return
        setObligations((obs) => obs.map((o) => o.id === id ? { ...o, is_closed: true } : o))
        try {
            await FinanceService.closeObligation(user.id, id)
            showToast('Yükümlülük kapatıldı', 'success', 2000)
        } catch (err) {
            setObligations((obs) => obs.map((o) => o.id === id ? { ...o, is_closed: false } : o))
            const msg = err instanceof Error ? err.message : 'Yükümlülük kapatılamadı'
            showToast(msg, 'error')
        }
    }, [user, showToast])

    const reopenObligation = useCallback(async (id: string) => {
        if (!user) return
        setObligations((obs) => obs.map((o) => o.id === id ? { ...o, is_closed: false } : o))
        try {
            await FinanceService.reopenObligation(user.id, id)
            showToast('Yükümlülük tekrar açıldı', 'success', 2000)
        } catch (err) {
            setObligations((obs) => obs.map((o) => o.id === id ? { ...o, is_closed: true } : o))
            const msg = err instanceof Error ? err.message : 'Yükümlülük tekrar açılamadı'
            showToast(msg, 'error')
        }
    }, [user, showToast])

    const deleteObligation = useCallback(async (id: string) => {
        if (!user) return
        const snapshot = obligations.find((o) => o.id === id)
        setObligations((obs) => obs.filter((o) => o.id !== id))
        try {
            await FinanceService.deleteObligation(user.id, id)
            showToast('Yükümlülük silindi', 'success', 2000)
        } catch (err) {
            if (snapshot) setObligations((obs) => [snapshot, ...obs])
            const msg = err instanceof Error ? err.message : 'Yükümlülük silinemedi'
            showToast(msg, 'error')
        }
    }, [user, obligations, showToast])

    const getObligationDetail = useCallback(async (id: string): Promise<ObligationWithDerived | null> => {
        if (!user) return null
        try {
            return await FinanceService.getObligationDetail(user.id, id)
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Yükümlülük detayı yüklenemedi'
            showToast(msg, 'error')
            return null
        }
    }, [user, showToast])

    // ──────────────────────────────────────────────
    // RECURRING TEMPLATES
    // ──────────────────────────────────────────────

    const createRecurringTemplate = useCallback(async (input: {
        type: 'income' | 'expense'
        amountTl: string
        currency?: string
        category_id?: string
        tag_id?: string
        name: string
        note?: string
        frequency: RecurringFrequency
        next_occurrence: string
        end_date?: string
    }): Promise<RecurringTemplate | null> => {
        if (!user) return null
        try {
            const amountKurus = tlToKurus(input.amountTl)
            if (amountKurus <= 0) {
                showToast('Geçerli bir tutar girin', 'error')
                return null
            }
            const tmpl = await FinanceService.createRecurringTemplate(user.id, {
                ...input,
                amount: amountKurus,
            })
            setRecurringTemplates((prev) => [tmpl, ...prev])
            showToast('Tekrarlayan şablon oluşturuldu', 'success', 2000)
            return tmpl
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Şablon oluşturulamadı'
            showToast(msg, 'error')
            return null
        }
    }, [user, showToast])

    const updateRecurringTemplate = useCallback(async (
        id: string,
        updates: Partial<{
            type: 'income' | 'expense'
            amountTl: string
            currency: string
            category_id: string | null
            tag_id: string | null
            name: string
            note: string | null
            frequency: RecurringFrequency
            next_occurrence: string
            end_date: string | null
            is_active: boolean
        }>
    ): Promise<RecurringTemplate | null> => {
        if (!user) return null
        try {
            const payload: any = { ...updates }

            // Convert amountTl string to kuruş integer if provided
            if (updates.amountTl) {
                const amountKurus = tlToKurus(updates.amountTl)
                if (amountKurus <= 0) {
                    showToast('Geçerli bir tutar girin', 'error')
                    return null
                }
                payload.amount = amountKurus
                delete payload.amountTl // Do not send UI string representation to DB
            }

            const updated = await FinanceService.updateRecurringTemplate(user.id, id, payload)

            setRecurringTemplates((prev) => prev.map(t => t.id === id ? updated : t))
            showToast('Tekrarlayan şablon güncellendi', 'success', 2000)
            return updated
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Şablon güncellenemedi'
            showToast(msg, 'error')
            return null
        }
    }, [user, showToast])

    const generateTransactionFromTemplate = useCallback(async (templateId: string): Promise<FinanceTransaction | null> => {
        if (!user) return null
        try {
            const txn = await FinanceService.generateTransactionFromTemplate(user.id, templateId)
            // Add the new transaction and refresh templates for updated next_occurrence
            setTransactions((prev) => [txn, ...prev])
            const refreshed = await FinanceService.getRecurringTemplates(user.id)
            setRecurringTemplates(refreshed)
            showToast('İşlem oluşturuldu ve sonraki tarih güncellendi', 'success', 2500)
            return txn
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'İşlem oluşturulamadı'
            showToast(msg, 'error')
            return null
        }
    }, [user, showToast])

    const deleteRecurringTemplate = useCallback(async (id: string) => {
        if (!user) return
        const snapshot = recurringTemplates.find((t) => t.id === id)
        setRecurringTemplates((prev) => prev.filter((t) => t.id !== id))
        try {
            await FinanceService.deleteRecurringTemplate(user.id, id)
            showToast('Şablon silindi', 'success', 2000)
        } catch (err) {
            if (snapshot) setRecurringTemplates((prev) => [snapshot, ...prev])
            const msg = err instanceof Error ? err.message : 'Şablon silinemedi'
            showToast(msg, 'error')
        }
    }, [user, recurringTemplates, showToast])

    // ──────────────────────────────────────────────
    // Context value (stable reference via useMemo)
    // ──────────────────────────────────────────────

    const value: FinanceContextType = useMemo(() => ({
        categories,
        tags,
        transactions: filteredTransactions,
        obligations,
        recurringTemplates,
        loading,
        error,
        transactionFilters,
        setTransactionFilters,
        getDashboardStats,
        createCategory,
        updateCategory,
        deleteCategory,
        createTag,
        deleteTag,
        createTransaction,
        updateTransaction,
        updateTransactionWithReceipt,
        archiveTransaction,
        deleteTransaction,
        createObligation,
        updateObligation,
        closeObligation,
        reopenObligation,
        deleteObligation,
        getObligationDetail,
        createRecurringTemplate,
        updateRecurringTemplate,
        generateTransactionFromTemplate,
        deleteRecurringTemplate,
        getTagsForCategory,
    }), [
        categories, tags, filteredTransactions, obligations, recurringTemplates,
        loading, error, transactionFilters,
        getDashboardStats,
        createCategory, updateCategory, deleteCategory,
        createTag, deleteTag,
        createTransaction, updateTransaction, updateTransactionWithReceipt, archiveTransaction, deleteTransaction,
        createObligation, updateObligation, closeObligation, reopenObligation, deleteObligation, getObligationDetail,
        createRecurringTemplate, updateRecurringTemplate, generateTransactionFromTemplate, deleteRecurringTemplate,
        getTagsForCategory,
    ])

    return (
        <FinanceContext.Provider value={value}>
            {children}
        </FinanceContext.Provider>
    )
}
