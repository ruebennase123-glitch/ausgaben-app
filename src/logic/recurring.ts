import type { AppData, Transaction } from '../types'
import { addMonths, currentMonth, daysInMonth, today } from './dates'
import { RECURRING_NS, uuidv5 } from './uuid5'

/**
 * Creates the monthly entries for all active recurring rules up to today.
 * Idempotent: a month is generated only once per rule (also if the user later
 * deleted the generated entry – deleted entries are kept as tombstones).
 *
 * Sync-safe: id = uuidv5(ruleId|month) and fixed timestamps (booking day, local midnight),
 * so two devices generating the same entry create an identical row (no double booking),
 * and any later user edit/delete is always newer than the generated version.
 */
export function generateRecurring(data: AppData): { data: AppData; created: number } {
  const t = today()
  const cm = currentMonth()
  const newTx: Transaction[] = []
  const existing = new Set(
    data.transactions.filter((tx) => tx.recurringId).map((tx) => `${tx.recurringId}|${tx.date.slice(0, 7)}`),
  )
  for (const rule of data.recurring) {
    if (!rule.active || rule.deleted) continue
    for (let m = rule.startMonth, guard = 0; m <= cm && guard < 120; m = addMonths(m, 1), guard++) {
      const day = Math.min(rule.dayOfMonth, daysInMonth(m))
      const date = `${m}-${String(day).padStart(2, '0')}`
      if (date > t) break
      if (existing.has(`${rule.id}|${m}`)) continue
      const stamp = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, day).toISOString()
      newTx.push({
        id: uuidv5(`${rule.id}|${m}`, RECURRING_NS),
        createdAt: stamp,
        updatedAt: stamp,
        type: rule.type,
        amountCents: rule.amountCents,
        categoryId: rule.categoryId,
        personId: rule.personId,
        note: rule.note,
        date,
        recurringId: rule.id,
      })
      existing.add(`${rule.id}|${m}`)
    }
  }
  if (!newTx.length) return { data, created: 0 }
  return { data: { ...data, transactions: [...data.transactions, ...newTx] }, created: newTx.length }
}
