import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedBrowserClient: SupabaseClient | null = null;

function readSupabaseUrl(): string {
  return (
    import.meta.env.VITE_SUPABASE_URL ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
}

function readSupabaseAnonKey(): string {
  return (
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();
}

export function isBrowserSupabaseConfigured(): boolean {
  const url = readSupabaseUrl();
  const anonKey = readSupabaseAnonKey();
  return Boolean(url && anonKey && /^https?:\/\/.+/.test(url));
}

export function getBrowserSupabase(): SupabaseClient {
  if (cachedBrowserClient) return cachedBrowserClient;

  const url = readSupabaseUrl();
  const anonKey = readSupabaseAnonKey();
  if (!url || !anonKey || !/^https?:\/\/.+/.test(url)) {
    throw new Error(
      'Konfigurasi Supabase (VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY) belum diatur.',
    );
  }

  cachedBrowserClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return cachedBrowserClient;
}
