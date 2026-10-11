import type { Category, TxType } from '../types'

export const CATEGORIES: Category[] = [
  { id: 'lebensmittel', name: 'Lebensmittel', emoji: '🛒', type: 'expense', color: '#22c55e' },
  { id: 'wohnen', name: 'Wohnen', emoji: '🏠', type: 'expense', color: '#6366f1' },
  { id: 'mobilitaet', name: 'Mobilität', emoji: '🚗', type: 'expense', color: '#0ea5e9' },
  { id: 'freizeit', name: 'Freizeit', emoji: '🎉', type: 'expense', color: '#f59e0b' },
  { id: 'restaurant', name: 'Restaurant', emoji: '🍝', type: 'expense', color: '#ef4444' },
  { id: 'gesundheit', name: 'Gesundheit', emoji: '💊', type: 'expense', color: '#14b8a6' },
  { id: 'kleidung', name: 'Kleidung', emoji: '👕', type: 'expense', color: '#ec4899' },
  { id: 'abos', name: 'Abos', emoji: '📺', type: 'expense', color: '#8b5cf6' },
  { id: 'geschenke', name: 'Geschenke', emoji: '🎁', type: 'expense', color: '#f97316' },
  { id: 'sonstiges', name: 'Sonstiges', emoji: '📦', type: 'expense', color: '#64748b' },
  { id: 'gehalt', name: 'Gehalt', emoji: '💼', type: 'income', color: '#10b981' },
  { id: 'einnahme-sonstiges', name: 'Sonstiges', emoji: '💶', type: 'income', color: '#84cc16' },
]

const byId = new Map(CATEGORIES.map((c) => [c.id, c]))

export function getCategory(id: string): Category {
  return byId.get(id) ?? { id, name: 'Unbekannt', emoji: '❓', type: 'expense', color: '#94a3b8' }
}

export function categoriesFor(type: TxType): Category[] {
  return CATEGORIES.filter((c) => c.type === type)
}
