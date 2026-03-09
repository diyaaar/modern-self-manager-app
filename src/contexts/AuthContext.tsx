import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import { User, Session, AuthError } from '@supabase/supabase-js'
import { getSupabaseClient } from '../lib/supabase'

// Lazy initialization - only get client when needed
const getSupabase = () => getSupabaseClient()

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  avatarUrl: string | null
  displayName: string | null
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
  getCurrentUser: () => Promise<User | null>
  updateAvatar: (avatarUrl: string | null) => Promise<void>
  refreshAvatar: () => Promise<void>
  updateDisplayName: (name: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)

  // Fetch avatar URL and display name from users table
  const fetchAvatar = useCallback(async (userId: string, fallbackName?: string) => {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('users')
        .select('avatar_url, full_name')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('Error fetching user profile:', error)
        setAvatarUrl(null)
        setDisplayName(fallbackName || null)
        return
      }

      setAvatarUrl(data?.avatar_url || null)
      setDisplayName(data?.full_name || fallbackName || null)
    } catch (err) {
      console.error('Error fetching user profile:', err)
      setAvatarUrl(null)
      setDisplayName(fallbackName || null)
    }
  }, [])

  useEffect(() => {
    try {
      const supabase = getSupabase()
      // Get initial session
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchAvatar(session.user.id, session.user.user_metadata?.full_name)
        }
        setLoading(false)
      }).catch(() => {
        setLoading(false)
      })

      // Listen for auth changes
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchAvatar(session.user.id, session.user.user_metadata?.full_name)
        } else {
          setAvatarUrl(null)
          setDisplayName(null)
        }
        setLoading(false)
      })

      return () => subscription.unsubscribe()
    } catch (error) {
      setLoading(false)
      // Error will be handled by ErrorBoundary
    }
  }, [fetchAvatar])

  const signUp = async (email: string, password: string) => {
    const supabase = getSupabase()
    const { error } = await supabase.auth.signUp({
      email,
      password,
    })
    return { error }
  }

  const signIn = async (email: string, password: string) => {
    const supabase = getSupabase()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { error }
  }

  const signOut = async () => {
    const supabase = getSupabase()
    await supabase.auth.signOut()
  }

  const getCurrentUser = async () => {
    const supabase = getSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    return user
  }

  const updateAvatar = async (newAvatarUrl: string | null) => {
    if (!user) return

    const supabase = getSupabase()
    const { error } = await supabase
      .from('users')
      .update({ avatar_url: newAvatarUrl })
      .eq('id', user.id)

    if (error) {
      console.error('Error updating avatar:', error)
      throw error
    }

    setAvatarUrl(newAvatarUrl)
  }

  const refreshAvatar = async () => {
    if (!user) return
    await fetchAvatar(user.id, user.user_metadata?.full_name)
  }

  const updateDisplayName = async (name: string) => {
    if (!user) return
    const trimmed = name.trim()
    if (!trimmed) return

    const supabase = getSupabase()

    // Update users table (primary source)
    const { error: dbError } = await supabase
      .from('users')
      .update({ full_name: trimmed })
      .eq('id', user.id)

    if (dbError) {
      console.error('Error updating display name in DB:', dbError)
      throw dbError
    }

    // Also sync to auth metadata for consistency
    const { error: authError } = await supabase.auth.updateUser({ data: { full_name: trimmed } })
    if (authError) {
      console.error('Error syncing display name to auth metadata:', authError)
    }

    setDisplayName(trimmed)
  }

  const value = {
    user,
    session,
    loading,
    avatarUrl,
    displayName,
    signUp,
    signIn,
    signOut,
    getCurrentUser,
    updateAvatar,
    refreshAvatar,
    updateDisplayName,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

