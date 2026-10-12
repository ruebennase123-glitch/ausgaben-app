import type { Category, TxType } from '../types'

// Categories are referenced by stable `id` only, so adding/renaming needs no data migration
// (e.g. 'lebensmittel' is shown as „Einkäufe“).
export const CATEGORIES: Category[] = [
  { id: 'lebensmittel', name: 'Einkäufe', emoji: '🛒', type: 'expense', color: '#22c55e' },
  { id: 'wohnen', name: 'Wohnen', emoji: '🏠', type: 'expense', color: '#6366f1' },
  { id: 'mobilitaet', name: 'Mobilität', emoji: '🚗', type: 'expense', color: '#0ea5e9' },
  { id: 'freizeit', name: 'Freizeit', emoji: '🎉', type: 'expense', color: '#f59e0b' },
  { id: 'restaurant', name: 'Restaurant', emoji: '🍝', type: 'expense', color: '#ef4444' },
  { id: 'gesundheit', name: 'Gesundheit', emoji: '💊', type: 'expense', color: '#14b8a6' },
  { id: 'kleidung', name: 'Shopping', emoji: '🛍️', type: 'expense', color: '#ec4899' },
  { id: 'abos', name: 'Abos', emoji: '📺', type: 'expense', color: '#8b5cf6' },
  { id: 'geschenke', name: 'Geschenke', emoji: '🎁', type: 'expense', color: '#f97316' },
  { id: 'renovieren', name: 'Renovieren', emoji: '🛠️', type: 'expense', color: '#a16207' },
  { id: 'urlaub', name: 'Urlaub', emoji: '🏖️', type: 'expense', color: '#0891b2' },
  { id: 'picnic', name: 'Picnic', emoji: '🥕', type: 'expense', color: '#4d7c0f' }, // online grocery delivery
  { id: 'lieferando', name: 'Lieferando', emoji: '🛵', type: 'expense', color: '#be185d' }, // food delivery
  { id: 'dating', name: 'Dating', emoji: '🥂', type: 'expense', color: '#d946ef' },
  { id: 'beauty', name: 'Beauty', emoji: '💄', type: 'expense', color: '#f9a8d4' },
  { id: 'versicherungen', name: 'Versicherungen', emoji: '🛡️', type: 'expense', color: '#1e40af' },
  { id: 'sparen', name: 'Sparen/Rücklagen', emoji: '🐷', type: 'expense', color: '#0f766e' },
  // 'Sonstiges' must stay the last expense category.
  { id: 'sonstiges', name: 'Sonstiges', emoji: '📦', type: 'expense', color: '#64748b' },
  { id: 'gehalt', name: 'Gehalt', emoji: '💼', type: 'income', color: '#10b981' },
  { id: 'einnahme-sonstiges', name: 'Sonstiges', emoji: '💶', type: 'income', color: '#84cc16' },
]

/** Retired categories: existing records are moved to the target category (see migrateCategories). */
export const RETIRED: Record<string, string> = { 'urlaub-gemeinsam': 'urlaub' }

const byId = new Map(CATEGORIES.map((c) => [c.id, c]))

export function getCategory(id: string): Category {
  return byId.get(id) ?? byId.get(RETIRED[id] ?? '') ?? { id, name: 'Unbekannt', emoji: '❓', type: 'expense', color: '#94a3b8' }
}

export function categoriesFor(type: TxType): Category[] {
  return CATEGORIES.filter((c) => c.type === type)
}
