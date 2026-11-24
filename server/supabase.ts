import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey = '';

export function isSupabaseEnabled(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return false;
  return /^https?:\/\/.+/.test(url);
}

export function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim() || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  if (!url || !serviceRoleKey || !/^https?:\/\/.+/.test(url)) {
    throw new Error('Konfigurasi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum lengkap.');
  }

  const configKey = `${url}|${serviceRoleKey.slice(0, 12)}`;
  if (!cachedClient || cachedConfigKey !== configKey) {
    cachedClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    cachedConfigKey = configKey;
  }

  return cachedClient;
}
