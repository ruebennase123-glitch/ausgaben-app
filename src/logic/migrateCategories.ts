import type { AppData } from '../types'
import { RETIRED } from '../data/categories'

/**
 * Moves records of retired categories to their replacement (e.g. „Gemeinsamer Urlaub“ → „Urlaub“).
 * Nothing is deleted: records get the new category id and a fresh updatedAt, so the change syncs to the
 * partner's phone like a normal edit. A retired budget is carried over (if the target has none) and set to 0.
 * Returns the same object when nothing needs migrating (no extra commits / sync loops).
 */
export function migrateCategories(d: AppData): AppData {
  const now = new Date().toISOString()
  const map = (id: string) => RETIRED[id]
  let changed = false
  const transactions = d.transactions.map((t) => {
    const to = map(t.categoryId)
    if (!to) return t
    changed = true
    return { ...t, categoryId: to, updatedAt: now }
  })
  const recurring = d.recurring.map((r) => {
    const to = map(r.categoryId)
    if (!to) return r
    changed = true
    return { ...r, categoryId: to, updatedAt: now }
  })
  let budgets = d.budgets
  for (const [from, to] of Object.entries(RETIRED)) {
    const b = budgets[from]
    if (!b || b.limitCents <= 0) continue
    changed = true
    budgets = { ...budgets, [from]: { ...b, limitCents: 0, updatedAt: now } }
    if (!budgets[to] || budgets[to].limitCents <= 0) budgets = { ...budgets, [to]: { ...b, categoryId: to, updatedAt: now } }
  }
  return changed ? { ...d, transactions, recurring, budgets } : d
}
