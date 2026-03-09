// ============================================================
// FINANCE PAGE — Main layout with tabbed sections
// Replaces placeholder. Wired to FinanceContext.
// ============================================================

import { useState } from 'react'
import { BarChart2, ArrowLeftRight, CreditCard, RefreshCcw, FolderOpen, AlertCircle, Coins } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFinance } from '../../contexts/FinanceContext'
import { FinanceDashboard } from './components/FinanceDashboard'
import { TransactionSection } from './components/TransactionSection'
import { ObligationSection } from './components/ObligationSection'
import { RecurringSection } from './components/RecurringSection'
import { CategoryManager } from './components/CategoryManager'
import { AssetsSection } from './components/AssetsSection'

type FinanceTab = 'dashboard' | 'transactions' | 'obligations' | 'assets' | 'recurring' | 'categories'

const TABS: { id: FinanceTab; label: string; Icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'Özet', Icon: BarChart2 },
    { id: 'transactions', label: 'İşlemler', Icon: ArrowLeftRight },
    { id: 'obligations', label: 'Borç & Alacak', Icon: CreditCard },
    { id: 'assets', label: 'Varlıklar', Icon: Coins },
    { id: 'recurring', label: 'Tekrarlayan', Icon: RefreshCcw },
    { id: 'categories', label: 'Kategoriler', Icon: FolderOpen },
]

export function FinancePage() {
    const { error } = useFinance()
    const [activeTab, setActiveTab] = useState<FinanceTab>('dashboard')

    return (
        <div className="p-6 space-y-6">
            {/* Error Banner */}
            {error && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="flex items-center gap-2 px-4 py-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm"
                >
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                </motion.div>
            )}

            {/* Tab Navigation */}
            <div className="w-full overflow-x-auto scrollbar-hide p-1 bg-background-elevated/50 backdrop-blur-sm border border-white/5 rounded-2xl">
                <div className="flex gap-1 sm:w-full min-w-max sm:min-w-0">
                    {TABS.map(({ id, label, Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`
                  relative flex-shrink-0 sm:flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl transition-all duration-200
                  ${activeTab === id ? 'text-white' : 'text-text-tertiary hover:text-text-primary'}
                `}
                        >
                            {activeTab === id && (
                                <motion.div
                                    layoutId="financeTabBg"
                                    className="absolute inset-0 bg-primary/20 border border-primary/20 rounded-xl"
                                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                                />
                            )}
                            <Icon className="w-5 h-5 sm:w-4 sm:h-4 relative z-10" />
                            <span className="relative z-10 text-[10px] sm:text-sm font-medium leading-tight text-center whitespace-nowrap px-0.5">
                                {label}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.2 }}
                >
                    {activeTab === 'dashboard' && <FinanceDashboard />}
                    {activeTab === 'transactions' && <TransactionSection />}
                    {activeTab === 'obligations' && <ObligationSection />}
                    {activeTab === 'assets' && <AssetsSection />}
                    {activeTab === 'recurring' && <RecurringSection />}
                    {activeTab === 'categories' && <CategoryManager />}
                </motion.div>
            </AnimatePresence>
        </div>
    )
}
