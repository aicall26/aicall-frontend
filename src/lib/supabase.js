import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Folosim storageKey-ul DEFAULT al supabase-js (sb-<ref>-auth-token)
// ca sa NU invalidam sesiunile existente. persistSession/autoRefreshToken
// sunt deja default true, dar le punem explicit pentru claritate.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});
