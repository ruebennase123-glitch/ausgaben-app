// Public Supabase project settings. The publishable key is designed to be public;
// all data access is protected by Row Level Security (see supabase/migrations).
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://vjuengqneehjwhbiaxcj.supabase.co'
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_Qrb2VaQeuNjZH7vPnKK0VA_wKAcWk7y'
export const SYNC_ENABLED = import.meta.env.VITE_SYNC_DISABLED !== '1' && !!SUPABASE_URL && !!SUPABASE_KEY
