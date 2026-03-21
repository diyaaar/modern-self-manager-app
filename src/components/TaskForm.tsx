import { useState, useRef, useEffect, FormEvent } from 'react'
import { motion } from 'framer-motion'
import {
  Calendar,
  Flag,
  Save,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { useTasks } from '../contexts/TasksContext'
import { useTags } from '../contexts/TagsContext'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspaces } from '../contexts/WorkspacesContext'
import { useToast } from '../contexts/ToastContext'
import { TaskWithSubtasks } from '../types/task'
import { format } from 'date-fns'
import { TagInput } from './TagInput'
import { formatDateTimeForCalendar } from '../lib/calendarEventFormat'
import { parseDBTimestamp } from '../utils/dateUtils'

interface TaskFormProps {
  task?: TaskWithSubtasks
  parentTaskId?: string
  onCancel: () => void
  onSave: () => void
}

export function TaskForm({ task, parentTaskId, onCancel, onSave }: TaskFormProps) {
  const { createTask, updateTask } = useTasks()
  const { createTag, getTaskTags, addTagToTask, removeTagFromTask } = useTags()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { currentWorkspaceId } = useWorkspaces()

  const [title, setTitle] = useState(task?.title || '')
  const [description, setDescription] = useState(task?.description || '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | null>(task?.priority || null)
  const [deadline, setDeadline] = useState(task?.deadline ? formatDateTimeForCalendar(parseDBTimestamp(task.deadline)).slice(0, 16) : '')
  const [tags, setTags] = useState<any[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (task) {
      getTaskTags(task.id).then(setTags)
    }
    // Focus title input on mount
    setTimeout(() => titleInputRef.current?.focus(), 100)
  }, [task, getTaskTags])

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!title.trim() || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    try {
      const taskData = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        workspace_id: currentWorkspaceId,
      }

      if (task) {
        await updateTask(task.id, taskData)
        // Handle tags for existing task
        const currentTags = await getTaskTags(task.id)
        const currentTagIds = new Set(currentTags.map(t => t.id))
        const newTagIds = new Set(tags.map(t => t.id))

        // Tags to add
        for (const tag of tags) {
          if (!currentTagIds.has(tag.id)) {
            await addTagToTask(task.id, tag.id)
          }
        }

        // Tags to remove
        for (const tag of currentTags) {
          if (!newTagIds.has(tag.id)) {
            await removeTagFromTask(task.id, tag.id)
          }
        }
      } else {
        const newTask = await createTask({
          ...taskData,
          parent_task_id: parentTaskId || null,
          completed: false,
          user_id: user?.id,
        } as any)

        if (newTask) {
          // Link tags for new task
          for (const tag of tags) {
            await addTagToTask(newTask.id, tag.id)
          }
        }
      }
      onSave()
      showToast(task ? 'Görev güncellendi' : 'Görev oluşturuldu', 'success')
    } catch (err) {
      console.error('Failed to save task:', err)
      setError('Görev kaydedilemedi. Lütfen tekrar deneyin.')
      showToast('Görev kaydedilemedi', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  const getPriorityStyle = (p: string, isSelected: boolean) => {
    switch (p) {
      case 'high':
        return isSelected
          ? 'text-danger bg-danger/15 border-danger/30'
          : 'text-text-tertiary hover:text-danger hover:bg-danger/10 border-transparent hover:border-danger/20'
      case 'medium':
        return isSelected
          ? 'text-warning bg-warning/15 border-warning/30'
          : 'text-text-tertiary hover:text-warning hover:bg-warning/10 border-transparent hover:border-warning/20'
      case 'low':
        return isSelected
          ? 'text-success bg-success/15 border-success/30'
          : 'text-text-tertiary hover:text-success hover:bg-success/10 border-transparent hover:border-success/20'
      default:
        return 'text-text-tertiary bg-white/5 border-white/10 hover:bg-white/10'
    }
  }

  const getPriorityLabel = (p: string) => {
    switch (p) {
      case 'high': return 'Yüksek'
      case 'medium': return 'Orta'
      case 'low': return 'Düşük'
      default: return ''
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`
        relative rounded-xl border border-white/10 bg-background-elevated/50 backdrop-blur-xl shadow-glass
        ${parentTaskId ? 'ml-0 sm:ml-4 mb-4' : 'mb-6'}
      `}
    >
      <div className="p-3 space-y-3">
        {/* Title & Description Input Container */}
        <div className="bg-white/[0.04] border border-white/20 rounded-xl px-3 py-2.5 flex items-start gap-3 transition-colors focus-within:border-primary/40 focus-within:bg-white/[0.06]">
          <div className="mt-1 flex-shrink-0">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-primary/40" />
          </div>
          <div className="flex-1 space-y-2">
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={parentTaskId ? "Yeni alt görev başlığı..." : "Görev başlığı..."}
              className="w-full bg-transparent border-none p-0 text-base font-medium placeholder:text-text-tertiary/50 focus:ring-0 text-text-primary"
            />

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Açıklama (isteğe bağlı)"
              rows={1}
              className="w-full bg-transparent border-none p-0 text-xs text-text-secondary placeholder:text-text-tertiary/50 focus:ring-0 resize-none font-normal leading-relaxed"
              style={{ minHeight: '24px' }}
            />
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Priority Toggles */}
          <div className="flex items-center gap-1.5">
            {(['low', 'medium', 'high'] as const).map((p) => {
              const isSelected = priority === p
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(isSelected ? null : p)}
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200
                    ${getPriorityStyle(p, isSelected)}
                  `}
                  title={`Önceliği ${p} olarak ayarla`}
                >
                  <Flag className={`w-3.5 h-3.5 ${isSelected ? 'fill-current' : ''}`} />
                  <span className={isSelected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}>
                    {getPriorityLabel(p)}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="h-4 w-px bg-white/10" />

          {/* Date Picker */}
          <div className="relative group">
            <label className={`
              flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all border border-white/5
              ${deadline ? 'bg-primary/10 text-primary border-primary/20' : 'bg-white/5 text-text-tertiary hover:text-text-secondary hover:bg-white/10'}
            `}>
              <Calendar className="w-3.5 h-3.5" />
              <span>{deadline ? format(new Date(deadline), 'd MMM, HH:mm') : 'Bitiş Tarihi'}</span>
              <input
                type="datetime-local"
                value={deadline}
                onClick={(e) => {
                  if ('showPicker' in HTMLInputElement.prototype) {
                    try {
                      e.currentTarget.showPicker()
                    } catch (err) { }
                  }
                }}
                onChange={(e) => setDeadline(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Tag Input */}
        <div>
          <TagInput
            selectedTags={tags} // tags state
            onTagsChange={setTags}
            onCreateTag={async (name, color) => {
              try {
                const newTag = await createTag({ name, color })
                return newTag
              } catch (e) {
                return null
              }
            }}
            placeholder="Etiket ekle..."
            className="w-full"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 text-danger text-xs pl-7 bg-danger/5 p-2 rounded-lg border border-danger/10">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-background-tertiary/30 border-t border-white/5 rounded-b-xl">
        <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
          <span className="hidden sm:inline-block opacity-60">Kaydetmek için ⌘+Enter'a basın</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-white/5 rounded-lg transition-colors"
          >
            İptal
          </button>
          <button
            onClick={() => handleSubmit()}
            disabled={isSubmitting || !title.trim()}
            className={`
              flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all shadow-lg
              ${!title.trim()
                ? 'bg-white/5 text-text-tertiary cursor-not-allowed'
                : 'bg-primary hover:bg-primary-dark text-white shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5'
              }
            `}
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {task ? 'Değişiklikleri Kaydet' : 'Görev Ekle'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}
