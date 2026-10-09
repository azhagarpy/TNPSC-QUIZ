import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined;

/** Without a Supabase project the app runs in demo mode: solo practice on the bundled sample questions. */
export const isDemo = !url || !key;

let client: Promise<SupabaseClient> | null = null;

/**
 * The Supabase client. It is its own chunk (about a third of the app's
 * JavaScript), so the first screen paints without waiting for it.
 */
export function sb(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, key!, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    }),
  );
  return client;
}
// The session provider calls sb() in an effect, i.e. right after the first
// paint; that also picks up the sign-in code when returning from Google or a
// magic link.
