import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let supabase: SupabaseClient | null = null
export let initializationError: Error | null = null

// Validate configuration without throwing
function validateConfig(): Error | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Error('Missing Supabase environment variables. Please check your .env file.')
  }

  // Security check: Ensure we're not using the secret key in the browser
  // Anon keys are JWT tokens that start with 'eyJ', secret keys start with 'sb_secret_'
  if (supabaseAnonKey.includes('sb_secret_')) {
    return new Error(
      'SECURITY ERROR: You are using a SECRET key in the browser!\n\n' +
      'Please use the ANON/PUBLIC key from your Supabase dashboard:\n' +
      '1. Go to https://supabase.com/dashboard\n' +
      '2. Select your project → Settings → API\n' +
      '3. Copy the "anon public" key (starts with "eyJ...")\n' +
      '4. Update your .env file\n' +
      '5. Restart the dev server\n\n' +
      'Secret keys should NEVER be used in frontend code.'
    )
  }

  return null
}

// Initialize error on module load (doesn't throw)
initializationError = validateConfig()

// Only create client if validation passes
if (!initializationError) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey)
  } catch (error) {
    initializationError = error instanceof Error ? error : new Error('Failed to create Supabase client')
    console.error('Supabase client creation error:', initializationError)
  }
}

export const getSupabaseClient = (): SupabaseClient => {
  if (initializationError) {
    throw initializationError
  }
  if (!supabase) {
    throw new Error('Supabase client not initialized')
  }
  return supabase
}

// Export supabase for backward compatibility, but it may be null
export { supabase }

