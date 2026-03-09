import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react'
import { getSupabaseClient } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { useWorkspaces } from './WorkspacesContext'
import { useToast } from './ToastContext'
import { Task, TaskWithSubtasks, TaskInsert, TaskUpdate, TaskFilter, TaskSort } from '../types/task'
import { buildTaskTree, flattenTaskTree } from '../utils/taskUtils'
import { getColorIdFromHex } from '../utils/colorUtils'

const getSupabase = () => getSupabaseClient()

// Track pending updates to ignore our own realtime events
interface PendingUpdate {
  id: string
  type: 'create' | 'update' | 'delete'
  timestamp: number
  previousState?: Task // For rollback
}

interface TasksContextType {
  tasks: TaskWithSubtasks[]
  loading: boolean
  error: string | null
  createTask: (task: Omit<TaskInsert, 'user_id'>) => Promise<Task | null>
  updateTask: (id: string, updates: TaskUpdate, suppressToast?: boolean) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  toggleTaskComplete: (id: string) => Promise<void>
  addAISuggestions: (taskId: string, suggestions: string[]) => Promise<void>
  filter: TaskFilter
  setFilter: (filter: TaskFilter) => void
  sort: TaskSort
  setSort: (sort: TaskSort) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  selectedTagIds: string[]
  setSelectedTagIds: (tagIds: string[]) => void
  filteredAndSortedTasks: TaskWithSubtasks[]
}

const TasksContext = createContext<TasksContextType | undefined>(undefined)

export function TasksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { currentWorkspaceId, workspaces } = useWorkspaces()
  const { showToast } = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const previousWorkspaceIdRef = useRef<string | null>(null)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [sort, setSort] = useState<TaskSort>('created')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])

  // Track pending updates to prevent duplicate realtime event handling
  const pendingUpdatesRef = useRef<Map<string, PendingUpdate>>(new Map())

  // Track original completion states of subtasks when parent is completed
  // Structure: Map<parentTaskId, Map<subtaskId, { completed: boolean, completed_at: string | null }>>
  const originalSubtaskStatesRef = useRef<Map<string, Map<string, { completed: boolean; completed_at: string | null }>>>(new Map())

  // Clean up old pending updates (older than 5 seconds)
  const cleanupPendingUpdates = useCallback(() => {
    const now = Date.now()
    const fiveSecondsAgo = now - 5000
    pendingUpdatesRef.current.forEach((update, id) => {
      if (update.timestamp < fiveSecondsAgo) {
        pendingUpdatesRef.current.delete(id)
      }
    })
  }, [])

  // Fetch tasks from Supabase
  const fetchTasks = useCallback(async () => {
    if (!user) {
      setTasks([])
      setLoading(false)
      return
    }

    // CRITICAL: Don't fetch if no workspace is selected
    if (!currentWorkspaceId) {
      previousWorkspaceIdRef.current = null
      setTasks([])
      setLoading(false)
      return
    }

    try {
      setError(null)

      // Always show loading state when fetching
      // This ensures users see feedback during workspace transitions
      setLoading(true)

      const supabase = getSupabase()
      const query = supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .eq('workspace_id', currentWorkspaceId) // CRITICAL: Always filter by workspace_id


      const { data, error: fetchError } = await query
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (fetchError) {
        console.error('[TasksContext] Error fetching tasks:', fetchError)
        throw fetchError
      }


      // Normalize tasks: ensure archived field exists (default to false if null/undefined)
      const normalizedTasks = (data || []).map((task) => ({
        ...task,
        archived: task.archived ?? false, // Default to false if null/undefined
      }))

      // Log archived tasks for debugging
      const archivedCount = normalizedTasks.filter((t) => t.archived === true).length
      if (archivedCount > 0) {
      }

      // Update tasks immediately - AnimatePresence will handle smooth crossfade
      // Old tasks (from previous workspace) will fade out via exit animation
      // New tasks (for current workspace) will fade in via enter animation
      // The key={currentWorkspaceId} in HomePage ensures proper animation trigger
      setTasks(normalizedTasks)
      setLoading(false)
      previousWorkspaceIdRef.current = currentWorkspaceId
    } catch (err) {
      console.error('Error fetching tasks:', err)
      setError(err instanceof Error ? err.message : 'Görevler getirilemedi')
      setLoading(false)
      // On error, clear tasks to show error state clearly
      setTasks([])
    }
  }, [user, currentWorkspaceId])

  // Subscribe to task changes
  useEffect(() => {
    if (!user?.id) {
      return
    }

    // CRITICAL: Don't subscribe if no workspace is selected yet
    // Wait for workspace to be initialized
    if (!currentWorkspaceId) {
      return
    }

    const userId = user.id
    const workspaceId = currentWorkspaceId // Capture current workspace ID

    // CRITICAL: Always fetch tasks when workspace changes
    // Use a small delay to ensure workspace is fully set
    const fetchTimeout = setTimeout(() => {
      fetchTasks()
    }, 50)

    const supabase = getSupabase()
    const channelName = `tasks-changes-${userId}-${workspaceId}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'tasks',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // Task change received

          // Clean up old pending updates
          cleanupPendingUpdates()

          // Check if this is our own update
          const taskId = (payload.new as any)?.id || (payload.old as any)?.id
          if (taskId && typeof taskId === 'string') {
            const pendingUpdate = pendingUpdatesRef.current.get(taskId)

            if (pendingUpdate) {
              // This is our own update - we already updated the UI optimistically
              // Remove from pending after a short delay to handle rapid updates
              setTimeout(() => {
                pendingUpdatesRef.current.delete(taskId)
              }, 1000)
              return // Don't refetch - we already updated UI
            }
          }

          // This is an update from another source (or our update wasn't tracked)
          // CRITICAL: Handle workspace_id changes - task moved between workspaces
          const oldWorkspaceId = (payload.old as any)?.workspace_id
          const newWorkspaceId = (payload.new as any)?.workspace_id
          const taskWorkspaceId = newWorkspaceId || oldWorkspaceId
          const isWorkspaceChange = oldWorkspaceId !== newWorkspaceId

          if (currentWorkspaceId) {
            if (isWorkspaceChange) {
              // Task was moved between workspaces
              if (oldWorkspaceId === currentWorkspaceId) {
                // Task was moved FROM current workspace - remove it immediately
                const movedTaskId = (payload.new as any)?.id || (payload.old as any)?.id
                if (movedTaskId) {
                  setTasks((prevTasks) => prevTasks.filter((t) => t.id !== movedTaskId))
                }
              } else if (newWorkspaceId === currentWorkspaceId) {
                // Task was moved TO current workspace - refetch to get it
                fetchTasks()
              } else {
                // Task moved between other workspaces - ignore
              }
            } else if (taskWorkspaceId === currentWorkspaceId) {
              // Normal update for task in current workspace
              fetchTasks()
            } else if (!taskWorkspaceId) {
              // Task without workspace_id - check if it's a subtask of a task in current workspace
              const parentTaskId = (payload.new as any)?.parent_task_id || (payload.old as any)?.parent_task_id
              if (parentTaskId) {
                // This is a subtask - check if parent is in current workspace
                const parentTask = tasks.find((t) => t.id === parentTaskId)
                if (parentTask && parentTask.workspace_id === currentWorkspaceId) {
                  fetchTasks()
                } else {
                }
              } else {
                // Root task without workspace - refetch if no workspace selected
                fetchTasks()
              }
            } else {
            }
          } else {
            // If no workspace selected, only show tasks without workspace
            if (!taskWorkspaceId || taskWorkspaceId === null) {
              fetchTasks()
            } else {
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] ✗ Channel error - check Supabase Replication settings')
        } else if (status === 'TIMED_OUT') {
          console.error('[Realtime] ✗ Subscription timed out')
        } else if (status === 'CLOSED') {
          console.warn('[Realtime] ⚠ Channel closed')
        }
      })

    return () => {
      clearTimeout(fetchTimeout)
      supabase.removeChannel(channel)
    }
    // Re-subscribe when workspace changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentWorkspaceId, fetchTasks])

  // Create task with optimistic update
  const createTask = useCallback(
    async (taskData: Omit<TaskInsert, 'user_id'>): Promise<Task | null> => {
      if (!user) return null

      // Generate temporary ID for optimistic update
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      let optimisticTask: Task | null = null

      try {
        const supabase = getSupabase()

        // Build query for existing tasks - use is.null for null parent_task_id
        const parentTaskId = taskData.parent_task_id ?? null

        // CRITICAL: Position query must also filter by workspace_id
        if (!currentWorkspaceId) {
          throw new Error('Cannot create task: No workspace selected')
        }

        let positionQuery = supabase
          .from('tasks')
          .select('position')
          .eq('user_id', user.id)
          .eq('workspace_id', currentWorkspaceId) // CRITICAL: Filter by workspace

        if (parentTaskId === null || parentTaskId === undefined) {
          positionQuery = positionQuery.is('parent_task_id', null)
        } else {
          positionQuery = positionQuery.eq('parent_task_id', parentTaskId)
        }

        const { data: existingTasks, error: positionError } = await positionQuery
          .order('position', { ascending: false })
          .limit(1)

        if (positionError) {
          console.error('Error fetching position:', positionError)
          throw positionError
        }

        const maxPosition = existingTasks && existingTasks.length > 0
          ? (existingTasks[0].position ?? 0) + 1
          : 0

        // CRITICAL: Always set workspace_id to current workspace when creating task
        if (!currentWorkspaceId) {
          throw new Error('Cannot create task: No workspace selected')
        }

        // Get workspace color and calculate color_id
        const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId)
        const workspaceColor = currentWorkspace?.color || null
        const colorId = getColorIdFromHex(workspaceColor)

        // Prepare task data
        const taskToInsert: TaskInsert = {
          title: taskData.title.trim(),
          description: taskData.description?.trim() || null,
          priority: taskData.priority || null,
          deadline: taskData.deadline || null,
          parent_task_id: taskData.parent_task_id || null,
          workspace_id: currentWorkspaceId, // CRITICAL: Always use current workspace
          completed: false,
          user_id: user.id,
          position: maxPosition,
          color_id: colorId, // Assign color_id based on workspace color
          updated_at: new Date().toISOString(),
        }


        // Create optimistic task for immediate UI update
        optimisticTask = {
          id: tempId,
          user_id: taskToInsert.user_id,
          parent_task_id: taskToInsert.parent_task_id ?? null,
          workspace_id: taskToInsert.workspace_id ?? null,
          title: taskToInsert.title,
          description: taskToInsert.description ?? null,
          priority: taskToInsert.priority ?? null,
          deadline: taskToInsert.deadline ?? null,
          completed: taskToInsert.completed ?? false,
          completed_at: null,
          archived: false, // Always false since archive feature is removed
          position: taskToInsert.position ?? null,
          background_image_url: taskToInsert.background_image_url ?? null,
          background_image_display_mode: taskToInsert.background_image_display_mode ?? null,
          color_id: taskToInsert.color_id ?? null,
          created_at: new Date().toISOString(),
          updated_at: taskToInsert.updated_at ?? new Date().toISOString(),
        }

        // Optimistic update: add task immediately to UI
        setTasks((prevTasks) => [...prevTasks, optimisticTask!])

        // Track this as pending update
        pendingUpdatesRef.current.set(tempId, {
          id: tempId,
          type: 'create',
          timestamp: Date.now(),
        })

        // API call in background
        const { data, error: createError } = await supabase
          .from('tasks')
          .insert(taskToInsert)
          .select()
          .single()

        if (createError) {
          // Rollback: remove optimistic task
          setTasks((prevTasks) => prevTasks.filter((t) => t.id !== tempId))
          pendingUpdatesRef.current.delete(tempId)
          console.error('[Optimistic] Rollback: Task creation failed', createError)
          throw createError
        }

        // Replace optimistic task with real task
        setTasks((prevTasks) =>
          prevTasks.map((t) => (t.id === tempId ? data : t))
        )

        // Track the real ID for realtime event filtering
        pendingUpdatesRef.current.delete(tempId)
        pendingUpdatesRef.current.set(data.id, {
          id: data.id,
          type: 'create',
          timestamp: Date.now(),
        })

        // Clean up after a delay
        setTimeout(() => {
          pendingUpdatesRef.current.delete(data.id)
        }, 2000)

        showToast('Görev başarıyla oluşturuldu', 'success')
        return data
      } catch (err) {
        // Rollback if not already done
        if (optimisticTask) {
          setTasks((prevTasks) => prevTasks.filter((t) => t.id !== tempId))
          pendingUpdatesRef.current.delete(tempId)
        }
        console.error('Error creating task:', err)
        const errorMessage = err instanceof Error ? err.message : 'Görev oluşturulamadı'
        setError(errorMessage)
        showToast(errorMessage, 'error')
        return null
      }
    },
    [user, currentWorkspaceId, workspaces, showToast]
  )

  // Update task with optimistic update
  const updateTask = useCallback(
    async (id: string, updates: TaskUpdate, suppressToast = false) => {
      // Find the current task state for rollback
      const currentTask = tasks.find((t) => t.id === id)
      if (!currentTask) {
        console.warn('[Optimistic] Task not found for update:', id)
        return
      }

      const previousState = { ...currentTask }
      const updatedTask = { ...currentTask, ...updates, updated_at: new Date().toISOString() }

      // CRITICAL: Check if workspace_id is being changed
      const isWorkspaceChange = updates.workspace_id !== undefined && updates.workspace_id !== currentTask.workspace_id

      // If workspace is changing, calculate new color_id from new workspace color
      if (isWorkspaceChange && updates.workspace_id) {
        const newWorkspace = workspaces.find(w => w.id === updates.workspace_id)
        const newWorkspaceColor = newWorkspace?.color || null
        const newColorId = getColorIdFromHex(newWorkspaceColor)
        // Add color_id to updates
        updates.color_id = newColorId
      }

      // Get all subtask IDs BEFORE removing them from state (needed for database update)
      const getAllSubtasks = (parentId: string, allTasks: typeof tasks): string[] => {
        const directSubtasks = allTasks.filter((t) => t.parent_task_id === parentId)
        const allSubtasks: string[] = []

        directSubtasks.forEach((subtask) => {
          allSubtasks.push(subtask.id)
          // Recursively get nested subtasks
          const nestedSubtasks = getAllSubtasks(subtask.id, allTasks)
          allSubtasks.push(...nestedSubtasks)
        })

        return allSubtasks
      }

      const allSubtasksIds = isWorkspaceChange ? getAllSubtasks(id, tasks) : []

      // Optimistic update: immediately update UI
      setTasks((prevTasks) => {
        if (isWorkspaceChange) {
          // If moving to different workspace, remove parent task and all subtasks from current list immediately

          const idsToRemove = [id, ...allSubtasksIds]


          return prevTasks.filter((task) => !idsToRemove.includes(task.id))
        } else {
          // Normal update: update task in place
          return prevTasks.map((task) => (task.id === id ? updatedTask : task))
        }
      })

      // Track this as pending update
      pendingUpdatesRef.current.set(id, {
        id,
        type: 'update',
        timestamp: Date.now(),
        previousState: currentTask,
      })

      try {
        const supabase = getSupabase()

        // CRITICAL: If workspace is changing, also update all subtasks recursively
        if (isWorkspaceChange && updates.workspace_id && allSubtasksIds.length > 0) {

          // Get new workspace color for subtasks
          const newWorkspace = workspaces.find(w => w.id === updates.workspace_id)
          const newWorkspaceColor = newWorkspace?.color || null
          const newColorId = getColorIdFromHex(newWorkspaceColor)

          // Update all subtasks in database (including color_id)
          const { error: subtasksUpdateError } = await supabase
            .from('tasks')
            .update({
              workspace_id: updates.workspace_id,
              color_id: newColorId, // Update color_id for subtasks too
              updated_at: new Date().toISOString(),
            })
            .in('id', allSubtasksIds)

          if (subtasksUpdateError) {
            console.error('[Workspace Move] Failed to update subtasks:', subtasksUpdateError)
            // Don't throw here - we'll still try to update the parent task
            // The error will be caught and handled below
          } else {
          }
        }

        // Update the parent task
        const { error: updateError } = await supabase
          .from('tasks')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)

        if (updateError) {
          // Rollback: restore previous state
          // For workspace changes, we need to restore the parent task and all subtasks
          setTasks((prevTasks) => {
            if (isWorkspaceChange) {
              // Get all subtasks that were removed
              const getAllSubtasks = (parentId: string, allTasks: typeof tasks): typeof tasks => {
                const directSubtasks = allTasks.filter((t) => t.parent_task_id === parentId)
                const allSubtasks: typeof tasks = [...directSubtasks]

                directSubtasks.forEach((subtask) => {
                  // Recursively get nested subtasks
                  const nestedSubtasks = getAllSubtasks(subtask.id, allTasks)
                  allSubtasks.push(...nestedSubtasks)
                })

                return allSubtasks
              }

              // Restore parent task and all subtasks
              const allSubtasks = getAllSubtasks(id, tasks)
              const tasksToRestore = [previousState, ...allSubtasks]


              // Remove any duplicates and restore
              const existingIds = new Set(prevTasks.map((t) => t.id))
              const newTasks = tasksToRestore.filter((t) => !existingIds.has(t.id))
              return [...prevTasks, ...newTasks]
            } else {
              return prevTasks.map((task) => (task.id === id ? previousState : task))
            }
          })
          pendingUpdatesRef.current.delete(id)
          console.error('[Optimistic] Rollback: Task update failed', updateError)
          throw updateError
        }

        // Success - keep the optimistic update, clean up tracking after delay
        setTimeout(() => {
          pendingUpdatesRef.current.delete(id)
        }, 2000)

        // Don't show toast for every update (too noisy for checkbox toggles)
        // Only show for significant updates
        if (isWorkspaceChange) {
          // Workspace change toast will be shown by MoveTaskModal
          // Don't show generic update toast here
        } else if (updates.title || updates.description || updates.priority || updates.deadline) {
          if (!suppressToast) {
            showToast('Görev başarıyla güncellendi', 'success', 2000)
          }
        }
      } catch (err) {
        // Rollback if not already done
        // For workspace changes, we need to restore the parent task and all subtasks
        setTasks((prevTasks) => {
          if (isWorkspaceChange) {
            // Get all subtasks that were removed
            const getAllSubtasks = (parentId: string, allTasks: typeof tasks): typeof tasks => {
              const directSubtasks = allTasks.filter((t) => t.parent_task_id === parentId)
              const allSubtasks: typeof tasks = [...directSubtasks]

              directSubtasks.forEach((subtask) => {
                // Recursively get nested subtasks
                const nestedSubtasks = getAllSubtasks(subtask.id, allTasks)
                allSubtasks.push(...nestedSubtasks)
              })

              return allSubtasks
            }

            // Restore parent task and all subtasks
            const allSubtasks = getAllSubtasks(id, tasks)
            const tasksToRestore = [previousState, ...allSubtasks]


            // Remove any duplicates and restore
            const existingIds = new Set(prevTasks.map((t) => t.id))
            const newTasks = tasksToRestore.filter((t) => !existingIds.has(t.id))
            return [...prevTasks, ...newTasks]
          } else {
            return prevTasks.map((task) => (task.id === id ? previousState : task))
          }
        })
        pendingUpdatesRef.current.delete(id)
        console.error('Error updating task:', err)
        const errorMessage = err instanceof Error ? err.message : 'Görev güncellenemedi'
        setError(errorMessage)
        if (!suppressToast) {
          showToast(errorMessage, 'error')
        }
        throw err
      }
    },
    [tasks, workspaces, showToast]
  )

  // Delete task with optimistic update
  const deleteTask = useCallback(async (id: string) => {
    // Find the current task state for rollback
    const currentTask = tasks.find((t) => t.id === id)
    if (!currentTask) {
      console.warn('[Optimistic] Task not found for deletion:', id)
      return
    }

    // Get all subtasks recursively (including nested subtasks)
    const getAllSubtasks = (parentId: string, allTasks: typeof tasks): typeof tasks => {
      const directSubtasks = allTasks.filter((t) => t.parent_task_id === parentId)
      const allSubtasks: typeof tasks = [...directSubtasks]

      directSubtasks.forEach((subtask) => {
        // Recursively get nested subtasks
        const nestedSubtasks = getAllSubtasks(subtask.id, allTasks)
        allSubtasks.push(...nestedSubtasks)
      })

      return allSubtasks
    }

    const allSubtasks = getAllSubtasks(id, tasks)
    const allTaskIdsToDelete = [id, ...allSubtasks.map((t) => t.id)]

    // Optimistic update: remove task and all subtasks immediately from UI
    setTasks((prevTasks) => prevTasks.filter((task) => !allTaskIdsToDelete.includes(task.id)))

    // Track this as pending update
    pendingUpdatesRef.current.set(id, {
      id,
      type: 'delete',
      timestamp: Date.now(),
      previousState: currentTask,
    })

    try {
      const supabase = getSupabase()

      // Delete all subtasks first (to maintain referential integrity)
      if (allSubtasks.length > 0) {
        const { error: subtasksDeleteError } = await supabase
          .from('tasks')
          .delete()
          .in('id', allSubtasks.map((t) => t.id))

        if (subtasksDeleteError) {
          // Rollback: restore task and all subtasks
          setTasks((prevTasks) => {
            const restored = [...prevTasks, currentTask, ...allSubtasks]
            return restored
          })
          pendingUpdatesRef.current.delete(id)
          console.error('[Optimistic] Rollback: Subtasks deletion failed', subtasksDeleteError)
          throw subtasksDeleteError
        }
      }

      // Delete the parent task
      const { error: deleteError } = await supabase
        .from('tasks')
        .delete()
        .eq('id', id)

      if (deleteError) {
        // Rollback: restore task and all subtasks
        setTasks((prevTasks) => {
          const restored = [...prevTasks, currentTask, ...allSubtasks]
          return restored
        })
        pendingUpdatesRef.current.delete(id)
        console.error('[Optimistic] Rollback: Task deletion failed', deleteError)
        throw deleteError
      }

      // Clean up saved original states for deleted task and all its subtasks
      originalSubtaskStatesRef.current.delete(id)
      allSubtasks.forEach((subtask) => {
        originalSubtaskStatesRef.current.delete(subtask.id)
      })

      // Success - clean up tracking after delay
      setTimeout(() => {
        pendingUpdatesRef.current.delete(id)
      }, 2000)

      const subtaskCount = allSubtasks.length
      showToast(
        `Görev${subtaskCount > 0 ? ` ve ${subtaskCount} alt görev` : ''} başarıyla silindi`,
        'success',
        2000
      )
    } catch (err) {
      // Rollback if not already done
      setTasks((prevTasks) => {
        const restored = [...prevTasks, currentTask, ...allSubtasks]
        return restored
      })
      pendingUpdatesRef.current.delete(id)
      console.error('Error deleting task:', err)
      const errorMessage = err instanceof Error ? err.message : 'Görev silinemedi'
      setError(errorMessage)
      showToast(errorMessage, 'error')
    }
  }, [tasks, showToast])

  // Toggle task completion
  const toggleTaskComplete = useCallback(
    async (id: string) => {
      const task = flattenTaskTree(buildTaskTree(tasks)).find((t) => t.id === id)
      if (!task) return

      const newCompleted = !task.completed
      await updateTask(id, {
        completed: newCompleted,
        completed_at: newCompleted ? new Date().toISOString() : null,
      })

      // Helper to get all subtasks recursively (returns task objects, not just IDs)
      const getAllSubtasks = (parentId: string, allTasks: typeof tasks): typeof tasks => {
        const directSubtasks = allTasks.filter((t) => t.parent_task_id === parentId)
        const allSubtasks: typeof tasks = [...directSubtasks]

        directSubtasks.forEach((subtask) => {
          // Recursively get nested subtasks
          const nestedSubtasks = getAllSubtasks(subtask.id, allTasks)
          allSubtasks.push(...nestedSubtasks)
        })

        return allSubtasks
      }

      // If completing a task, save original states and mark all subtasks as completed recursively
      // If uncompleting, restore original states
      if (newCompleted) {
        const allSubtasks = getAllSubtasks(id, tasks)

        // Save original completion states before overriding
        if (allSubtasks.length > 0) {
          const originalStates = new Map<string, { completed: boolean; completed_at: string | null }>()

          allSubtasks.forEach((subtask) => {
            originalStates.set(subtask.id, {
              completed: subtask.completed,
              completed_at: subtask.completed_at,
            })
          })

          // Store original states for this parent task
          originalSubtaskStatesRef.current.set(id, originalStates)
        }

        // Mark all subtasks as completed in the database
        if (allSubtasks.length > 0) {
          try {
            const supabase = getSupabase()
            const { error: updateError } = await supabase
              .from('tasks')
              .update({
                completed: true,
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .in('id', allSubtasks.map((t) => t.id))

            if (updateError) {
              console.error('Error completing subtasks:', updateError)
              // Rollback: remove saved states if update failed
              originalSubtaskStatesRef.current.delete(id)
              // Don't throw - parent task is already completed
            } else {
            }
          } catch (err) {
            console.error('Error completing subtasks:', err)
            // Rollback: remove saved states if update failed
            originalSubtaskStatesRef.current.delete(id)
            // Don't throw - parent task is already completed
          }
        }
      } else {
        // Uncompleting: restore original states of all subtasks
        const originalStates = originalSubtaskStatesRef.current.get(id)

        if (originalStates && originalStates.size > 0) {
          try {
            const supabase = getSupabase()

            // Restore each subtask to its original state
            const restorePromises = Array.from(originalStates.entries()).map(async ([subtaskId, originalState]) => {
              const { error } = await supabase
                .from('tasks')
                .update({
                  completed: originalState.completed,
                  completed_at: originalState.completed_at,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', subtaskId)

              if (error) {
                console.error(`Error restoring subtask ${subtaskId}:`, error)
              }
            })

            await Promise.all(restorePromises)

            // Clean up: remove saved states after restoration
            originalSubtaskStatesRef.current.delete(id)
          } catch (err) {
            console.error('Error restoring subtask states:', err)
            // Don't throw - parent task is already uncompleted
          }
        }

        // Also uncomplete all parent tasks (existing behavior)
        let parentId = task.parent_task_id
        while (parentId) {
          const parent = tasks.find((t) => t.id === parentId)
          if (parent && parent.completed) {
            await updateTask(parentId, {
              completed: false,
              completed_at: null,
            })
          }
          parentId = parent?.parent_task_id || null
        }
      }
    },
    [tasks, updateTask]
  )


  // Add AI suggestions as subtasks
  const addAISuggestions = useCallback(
    async (taskId: string, suggestions: string[]) => {
      if (!user) return

      try {
        // Find parent task to get workspace_id
        const parentTask = tasks.find((t) => t.id === taskId)
        if (!parentTask) {
          throw new Error('Parent task not found')
        }

        // CRITICAL: Subtasks must have the same workspace_id as parent
        const workspaceId = parentTask.workspace_id || currentWorkspaceId
        if (!workspaceId) {
          throw new Error('Cannot create subtasks: No workspace available')
        }

        const supabase = getSupabase()
        // Get max position for new subtasks
        const { data: existingSubtasks } = await supabase
          .from('tasks')
          .select('position')
          .eq('user_id', user.id)
          .eq('parent_task_id', taskId)
          .order('position', { ascending: false })
          .limit(1)

        let startPosition = 0
        if (existingSubtasks && existingSubtasks.length > 0) {
          startPosition = (existingSubtasks[0].position ?? 0) + 1
        }

        // Create tasks for each suggestion
        const tasksToInsert = suggestions.map((suggestion, index) => ({
          user_id: user.id,
          parent_task_id: taskId,
          workspace_id: workspaceId, // CRITICAL: Set workspace_id for subtasks
          title: suggestion,
          position: startPosition + index,
          updated_at: new Date().toISOString(),
        }))

        const { data: insertedTasks, error: insertError } = await supabase
          .from('tasks')
          .insert(tasksToInsert)
          .select()

        if (insertError) throw insertError

        // CRITICAL: Optimistically update local state to show subtasks immediately
        if (insertedTasks && insertedTasks.length > 0) {
          setTasks((prevTasks) => {
            // Add new subtasks to the tasks array
            // Filter out any duplicates (in case realtime already added them)
            const existingIds = new Set(prevTasks.map((t) => t.id))
            const newTasks = insertedTasks.filter((t) => !existingIds.has(t.id))
            return [...prevTasks, ...newTasks]
          })
        }

        showToast(`Added ${suggestions.length} subtask${suggestions.length !== 1 ? 's' : ''}`, 'success')

        // Log suggestions to ai_suggestions table (optional)
        try {
          const suggestionsToLog = suggestions.map((suggestion) => ({
            task_id: taskId,
            suggestion,
            accepted: true,
          }))

          await supabase.from('ai_suggestions').insert(suggestionsToLog)
        } catch (logError) {
          // Non-critical error, just log it
          console.warn('Failed to log AI suggestions:', logError)
        }

        // Note: Realtime subscription will also handle the update, but optimistic update ensures immediate UI feedback
        // We don't need to refetch here as the optimistic update + realtime will keep things in sync
      } catch (err) {
        console.error('Error adding AI suggestions:', err)
        setError(err instanceof Error ? err.message : 'Failed to add suggestions')
        throw err
      }
    },
    [user, tasks, currentWorkspaceId, showToast, fetchTasks]
  )

  // State for tasks with tags (for filtering)
  const [tasksWithTags, setTasksWithTags] = useState<Map<string, string[]>>(new Map())

  // Fetch task tags for filtering
  useEffect(() => {
    if (!user || selectedTagIds.length === 0) {
      setTasksWithTags(new Map())
      return
    }

    const fetchTaskTags = async () => {
      const supabase = getSupabase()
      const { data } = await supabase
        .from('task_tags')
        .select('task_id, tag_id')
        .in('tag_id', selectedTagIds)

      if (data) {
        const taskTagsMap = new Map<string, string[]>()
        data.forEach((tt) => {
          const existing = taskTagsMap.get(tt.task_id) || []
          taskTagsMap.set(tt.task_id, [...existing, tt.tag_id])
        })
        setTasksWithTags(taskTagsMap)
      }
    }

    fetchTaskTags()
  }, [user, selectedTagIds])

  // Filter and sort tasks
  const filteredAndSortedTasks = useCallback(() => {
    // CRITICAL: Filter by workspace_id first to ensure only current workspace tasks are shown
    // This prevents old tasks from showing during workspace transitions
    let filtered: Task[] = tasks.filter((task) => {
      if (!currentWorkspaceId) return false
      return task.workspace_id === currentWorkspaceId
    })

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((task) =>
        task.title.toLowerCase().includes(query) ||
        task.description?.toLowerCase().includes(query)
      )
    }

    // Apply status filter
    if (filter === 'active') {
      filtered = filtered.filter((task) => !task.completed)
    } else if (filter === 'completed') {
      filtered = filtered.filter((task) => task.completed)
    }

    // Apply tag filter
    if (selectedTagIds.length > 0) {
      filtered = filtered.filter((task) => {
        const taskTagIds = tasksWithTags.get(task.id) || []
        return selectedTagIds.some((tagId) => taskTagIds.includes(tagId))
      })
    }


    // Apply sorting
    filtered.sort((a, b) => {
      switch (sort) {
        case 'deadline':
          if (!a.deadline && !b.deadline) return 0
          if (!a.deadline) return 1
          if (!b.deadline) return -1
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
        case 'priority': {
          const priorityOrder = { high: 3, medium: 2, low: 1, null: 0 }
          return (
            (priorityOrder[b.priority as keyof typeof priorityOrder] || 0) -
            (priorityOrder[a.priority as keyof typeof priorityOrder] || 0)
          )
        }
        case 'title':
          return a.title.localeCompare(b.title)
        case 'created':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
    })

    return buildTaskTree(filtered as TaskWithSubtasks[])
  }, [tasks, currentWorkspaceId, filter, sort, searchQuery, selectedTagIds, tasksWithTags])

  const value: TasksContextType = {
    tasks: buildTaskTree(tasks as TaskWithSubtasks[]),
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
    toggleTaskComplete,
    addAISuggestions,
    filter,
    setFilter,
    sort,
    setSort,
    searchQuery,
    setSearchQuery,
    selectedTagIds,
    setSelectedTagIds,
    filteredAndSortedTasks: filteredAndSortedTasks(),
  }

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}

export function useTasks() {
  const context = useContext(TasksContext)
  if (context === undefined) {
    throw new Error('useTasks must be used within a TasksProvider')
  }
  return context
}

