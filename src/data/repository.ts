import type { AppData } from '../types'

/**
 * Storage abstraction. v1 ships a localStorage implementation only.
 *
 * A later sync backend (e.g. Supabase) can be added by implementing this
 * interface (or wrapping the local repository): load locally first for instant
 * start-up, then pull remote rows changed since the last sync and merge them
 * per record by `updatedAt` (deleted records are tombstones with
 * `deleted: true`). See README.md -> "Sync später ergänzen".
 */
export interface DataRepository {
  load(): Promise<AppData | null>
  save(data: AppData): Promise<void>
}

export const STORAGE_KEY = 'ausgaben-app:v1'

export class LocalStorageRepository implements DataRepository {
  private key: string
  constructor(key = STORAGE_KEY) {
    this.key = key
  }

  async load(): Promise<AppData | null> {
    const raw = localStorage.getItem(this.key)
    if (!raw) return null
    return JSON.parse(raw) as AppData
  }

  async save(data: AppData): Promise<void> {
    localStorage.setItem(this.key, JSON.stringify(data))
  }
}
