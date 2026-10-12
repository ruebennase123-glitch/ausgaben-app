// Public Supabase project settings. The publishable key is designed to be public;
// all data access is protected by Row Level Security (see supabase/migrations).
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://vjuengqneehjwhbiaxcj.supabase.co'
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_Qrb2VaQeuNjZH7vPnKK0VA_wKAcWk7y'
export const SYNC_ENABLED = import.meta.env.VITE_SYNC_DISABLED !== '1' && !!SUPABASE_URL && !!SUPABASE_KEY
// Public VAPID key for Web Push (the private key lives only in the Edge Function secrets).
export const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? 'BEdvViq6Dx7KzKKbQL-yrpMbMZsc1o1A44uNoLpIc0pBQYfZ-_OpQfjMve74rxt3Y0J9_zUHFSRxT4PxXUVAWcQ'
