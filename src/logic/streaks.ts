import type { AppData, ISODate, PersonId } from '../types'
import { addDays, localDateOfTimestamp, today } from './dates'

/** Days on which someone actively logged (manual entries + "nichts ausgegeben" check-ins). */
export function loggedDays(data: AppData, person?: PersonId): Set<ISODate> {
  const s = new Set<ISODate>()
  for (const t of data.transactions) {
    if (t.recurringId || t.deleted) continue // auto-generated/deleted entries don't count
    if (person && t.personId !== person) continue
    s.add(localDateOfTimestamp(t.createdAt))
  }
  for (const c of data.checkins) {
    if (c.deleted || (person && c.personId !== person)) continue
    s.add(c.date)
  }
  return s
}

/**
 * Current streak in days. If today isn't logged yet, the streak up to
 * yesterday still counts (it only breaks after a full day without logging).
 */
export function currentStreak(days: Set<ISODate>): { length: number; loggedToday: boolean } {
  const t = today()
  const loggedToday = days.has(t)
  let d = loggedToday ? t : addDays(t, -1)
  let n = 0
  while (days.has(d)) {
    n++
    d = addDays(d, -1)
  }
  return { length: n, loggedToday }
}

export function longestStreak(days: Set<ISODate>): number {
  const sorted = [...days].sort()
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  return best
}

export function streaks(data: AppData) {
  const shared = loggedDays(data)
  return {
    shared: { ...currentStreak(shared), best: longestStreak(shared) },
    p1: currentStreak(loggedDays(data, 'p1')),
    p2: currentStreak(loggedDays(data, 'p2')),
  }
}

/** Last n days for a mini calendar: [{date, p1, p2}] */
export function lastDays(data: AppData, n: number) {
  const a = loggedDays(data, 'p1')
  const b = loggedDays(data, 'p2')
  const t = today()
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(t, i - n + 1)
    return { date, p1: a.has(date), p2: b.has(date) }
  })
}
