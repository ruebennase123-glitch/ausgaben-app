import type { AppData, Person } from '../types'
import { nowISO } from '../logic/id'

export const DEFAULT_JOINT: Person = { id: 'joint', name: 'Gemeinsam', emoji: '🤝' }

export function emptyData(): AppData {
  const now = nowISO()
  return {
    schemaVersion: 1,
    transactions: [],
    recurring: [],
    goals: [],
    checkins: [],
    budgets: {},
    badges: {},
    settings: {
      persons: [
        { id: 'p1', name: 'Ich', emoji: '🙂' },
        { id: 'p2', name: 'Partnerin', emoji: '😊' },
      ],
      theme: 'system',
      joint: { ...DEFAULT_JOINT },
      lastPersonId: 'p1',
      updatedAt: now,
    },
  }
}

/** Validates/normalises arbitrary JSON (backup import, older versions). Throws on garbage. */
export function normalizeData(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') throw new Error('Keine gültige Sicherungsdatei.')
  const r = raw as Partial<AppData> & { app?: string; data?: unknown }
  // Export files wrap the data: { app, exportedAt, data }
  if (r.app === 'ausgaben-app' && r.data) return normalizeData(r.data)
  if (r.schemaVersion !== 1) throw new Error('Unbekanntes Dateiformat (schemaVersion).')
  if (!Array.isArray(r.transactions)) throw new Error('Die Datei enthält keine Buchungen.')
  const base = emptyData()
  return {
    schemaVersion: 1,
    transactions: r.transactions.filter((t) => t && typeof t.amountCents === 'number' && typeof t.date === 'string'),
    recurring: Array.isArray(r.recurring) ? r.recurring : [],
    goals: Array.isArray(r.goals) ? r.goals.map((g) => ({ ...g, contributions: g.contributions ?? [] })) : [],
    checkins: Array.isArray(r.checkins) ? r.checkins : [],
    budgets: r.budgets && typeof r.budgets === 'object' ? r.budgets : {},
    badges: r.badges && typeof r.badges === 'object' ? r.badges : {},
    settings: {
      ...base.settings,
      ...(r.settings ?? {}),
      // Backward compatible: data from before the joint payer existed gets the default.
      joint: { ...DEFAULT_JOINT, ...(r.settings?.joint ?? {}), id: 'joint' },
    },
  }
}
