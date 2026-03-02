import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { useWorkspaces } from '../contexts/WorkspacesContext'
import { useToast } from '../contexts/ToastContext'
import { CreateWorkspaceModal } from './CreateWorkspaceModal'
import { ConfirmDialog } from './ConfirmDialog'
import { Workspace } from '../types/workspace'

interface SortableWorkspaceTabProps {
  workspace: Workspace
  isActive: boolean
  onClick: () => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function SortableWorkspaceTab({
  workspace,
  isActive,
  onClick,
  onDoubleClick,
  onContextMenu,
}: SortableWorkspaceTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workspace.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <motion.button
      ref={setNodeRef}
      style={{
        ...style,
        color: isActive ? workspace.color : undefined,
      }}
      {...attributes}
      {...listeners}
      data-workspace-id={workspace.id}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`
        flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl transition-all
        min-h-[44px] touch-manipulation relative
        ${isActive ? '' : 'hover:bg-background-tertiary/50 active:bg-background-tertiary/70'}
      `}
    >
      <span className="text-base sm:text-lg flex-shrink-0">{workspace.icon}</span>
      <span className="text-xs sm:text-sm font-medium whitespace-nowrap truncate max-w-[100px] sm:max-w-none">{workspace.name}</span>
      {isActive && (
        <motion.div
          layoutId="activeTabIndicator"
          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
          style={{
            backgroundColor: workspace.color,
          }}
          transition={{
            type: 'spring',
            stiffness: 500,
            damping: 30,
          }}
        />
      )}
    </motion.button>
  )
}

export function WorkspaceNavigation() {
  const {
    workspaces,
    currentWorkspaceId,
    setCurrentWorkspaceId,
    deleteWorkspace,
    reorderWorkspaces,
  } = useWorkspaces()
  const { showToast } = useToast()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [workspaceToDelete, setWorkspaceToDelete] = useState<string | null>(null)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ workspaceId: string; x: number; y: number } | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const [localWorkspaces, setLocalWorkspaces] = useState<Workspace[]>([])

  useEffect(() => {
    setLocalWorkspaces(workspaces)
  }, [workspaces])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (active && over && active.id !== over.id) {
      setLocalWorkspaces((items) => {
        const oldIndex = items.findIndex((w) => w.id === active.id)
        const newIndex = items.findIndex((w) => w.id === over.id)

        const newItems = arrayMove(items, oldIndex, newIndex)
        // Call backend with new order
        reorderWorkspaces(newItems.map((w: Workspace) => w.id))
        return newItems
      })
    }
  }

  // Auto-scroll when active workspace changes
  useEffect(() => {
    if (!scrollContainerRef.current || !currentWorkspaceId) return

    // Slight delay to ensure DOM is updated
    const timer = setTimeout(() => {
      if (!scrollContainerRef.current) return
      const activeElement = scrollContainerRef.current.querySelector(
        `button[data-workspace-id="${CSS.escape(currentWorkspaceId)}"]`
      )
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [currentWorkspaceId])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return
      }

      if (e.key === 'ArrowLeft') {
        handlePrevious()
      } else if (e.key === 'ArrowRight') {
        handleNext()
      } else if (e.key === 'Escape') {
        setContextMenu(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [workspaces, currentWorkspaceId])

  const handlePrevious = () => {
    const currentIndex = workspaces.findIndex((w) => w.id === currentWorkspaceId)
    if (currentIndex > 0) {
      setCurrentWorkspaceId(workspaces[currentIndex - 1].id)
    }
  }

  const handleNext = () => {
    const currentIndex = workspaces.findIndex((w) => w.id === currentWorkspaceId)
    if (currentIndex < workspaces.length - 1) {
      setCurrentWorkspaceId(workspaces[currentIndex + 1].id)
    }
  }

  const handleDelete = async () => {
    if (!workspaceToDelete) return

    try {
      await deleteWorkspace(workspaceToDelete)
      showToast('Çalışma alanı silindi', 'success', 2000)
      setShowDeleteConfirm(false)
      setWorkspaceToDelete(null)
    } catch (err) {
      console.error('Error deleting workspace:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete workspace'
      if (errorMessage.includes('last workspace')) {
        showToast('Son çalışma alanı silinemez', 'error', 3000)
      } else {
        showToast('Çalışma alanı silinemedi', 'error', 3000)
      }
    }
  }

  const handleContextMenu = (e: React.MouseEvent, workspaceId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ workspaceId, x: e.clientX, y: e.clientY })
  }

  const handleEdit = (workspaceId: string) => {
    setEditingWorkspaceId(workspaceId)
    setShowCreateModal(true)
    setContextMenu(null)
  }

  const handleDeleteClick = (workspaceId: string) => {
    setWorkspaceToDelete(workspaceId)
    setShowDeleteConfirm(true)
    setContextMenu(null)
  }

  const canGoPrevious = workspaces.findIndex((w) => w.id === currentWorkspaceId) > 0
  const canGoNext = workspaces.findIndex((w) => w.id === currentWorkspaceId) < workspaces.length - 1

  return (
    <>
      <div className="sticky top-0 z-40 pt-2 sm:pt-3 md:pt-4 pb-2">
        <div className="flex justify-center px-2">
          <motion.div
            layout
            initial={false}
            className="inline-flex items-center gap-0.5 sm:gap-1 px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 bg-background-secondary/80 backdrop-blur-md border border-background-tertiary rounded-xl sm:rounded-2xl shadow-lg max-w-[95vw] sm:max-w-[90vw] overflow-hidden"
            style={{
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            }}
          >
            {/* Previous Button */}
            <button
              onClick={handlePrevious}
              disabled={!canGoPrevious}
              className="flex-shrink-0 p-1.5 sm:p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-background-tertiary rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 active:scale-95 touch-manipulation"
              aria-label="Önceki çalışma alanı"
            >
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-text-tertiary" />
            </button>

            {/* Workspace Tabs */}
            <div
              ref={scrollContainerRef}
              className="flex items-center gap-1 overflow-x-auto scrollbar-hide"
            >
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={localWorkspaces.map((w: Workspace) => w.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  <AnimatePresence mode="popLayout">
                    {localWorkspaces.map((workspace) => {
                      const isActive = workspace.id === currentWorkspaceId
                      return (
                        <SortableWorkspaceTab
                          key={workspace.id}
                          workspace={workspace}
                          isActive={isActive}
                          onClick={() => setCurrentWorkspaceId(workspace.id)}
                          onDoubleClick={() => handleEdit(workspace.id)}
                          onContextMenu={(e) => handleContextMenu(e, workspace.id)}
                        />
                      )
                    })}
                  </AnimatePresence>
                </SortableContext>
              </DndContext>
            </div>

            {/* Next Button */}
            <button
              onClick={handleNext}
              disabled={!canGoNext}
              className="flex-shrink-0 p-1.5 sm:p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-background-tertiary rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 active:scale-95 touch-manipulation"
              aria-label="Sonraki çalışma alanı"
            >
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-text-tertiary" />
            </button>

            {/* Create Button */}
            <button
              onClick={() => {
                setEditingWorkspaceId(null)
                setShowCreateModal(true)
              }}
              className="flex-shrink-0 p-1.5 sm:p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-background-tertiary rounded-lg transition-all hover:scale-105 active:scale-95 touch-manipulation"
              aria-label="Yeni çalışma alanı oluştur"
            >
              <Plus className="w-4 h-4 sm:w-5 sm:h-5 text-text-tertiary" />
            </button>
          </motion.div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setContextMenu(null)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-50 bg-background-secondary border border-background-tertiary rounded-lg shadow-xl py-1 min-w-[140px] sm:min-w-[120px]"
            style={{
              left: `${Math.min(contextMenu.x, window.innerWidth - 160)}px`,
              top: `${Math.min(contextMenu.y, window.innerHeight - 100)}px`,
            }}
          >
            <button
              onClick={() => handleEdit(contextMenu.workspaceId)}
              className="w-full px-4 py-3 sm:py-2 text-left text-sm min-h-[44px] flex items-center text-text-secondary hover:bg-background-tertiary active:bg-background-tertiary/80 transition-colors touch-manipulation"
            >
              Düzenle
            </button>
            <button
              onClick={() => handleDeleteClick(contextMenu.workspaceId)}
              className="w-full px-4 py-3 sm:py-2 text-left text-sm min-h-[44px] flex items-center text-danger hover:bg-background-tertiary active:bg-background-tertiary/80 transition-colors touch-manipulation"
            >
              Sil
            </button>
          </motion.div>
        </>
      )}

      {/* Create/Edit Workspace Modal */}
      <CreateWorkspaceModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false)
          setEditingWorkspaceId(null)
        }}
        editingWorkspace={editingWorkspaceId ? workspaces.find((w) => w.id === editingWorkspaceId) : null}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false)
          setWorkspaceToDelete(null)
        }}
        onConfirm={handleDelete}
        title="Çalışma Alanını Sil"
        message={
          workspaceToDelete
            ? `"${workspaces.find((w) => w.id === workspaceToDelete)?.name}" isimli çalışma alanını silmek istediğinizden emin misiniz? Bu çalışma alanındaki tüm görevler başka bir çalışma alanına taşınacaktır.`
            : ''
        }
        confirmText="Sil"
        cancelText="İptal"
        confirmButtonColor="danger"
      />
    </>
  )
}

