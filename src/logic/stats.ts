import type { AppData, ISODate, MonthKey, PersonId, Transaction } from '../types'
import { addDays, today } from './dates'

export const live = (data: AppData) => data.transactions.filter((t) => !t.deleted)

export function txOfMonth(data: AppData, month: MonthKey, person?: PersonId): Transaction[] {
  return live(data)
    .filter((t) => t.date.startsWith(month) && (!person || t.personId === person))
    .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
}

export function totals(txs: Transaction[]) {
  let income = 0
  let expense = 0
  for (const t of txs) {
    if (t.type === 'income') income += t.amountCents
    else expense += t.amountCents
  }
  return { income, expense, balance: income - expense }
}

export function spendByCategory(txs: Transaction[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of txs) if (t.type === 'expense') m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amountCents)
  return m
}

export function budgetStatus(spent: number, limit: number) {
  const ratio = limit > 0 ? spent / limit : 0
  const level: 'ok' | 'warn' | 'over' = ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok'
  return { ratio, level, remaining: limit - spent }
}

function inRange(d: ISODate, from: ISODate, to: ISODate) {
  return d >= from && d <= to
}

/** Weekly recap: last 7 days (incl. today) vs. the 7 days before. */
export function weeklyRecap(data: AppData) {
  const t = today()
  const from = addDays(t, -6)
  const prevFrom = addDays(t, -13)
  const prevTo = addDays(t, -7)
  // Recurring fixed costs are excluded so the recap reflects day-to-day spending.
  const txs = live(data).filter((x) => !x.recurringId)
  const week = txs.filter((x) => inRange(x.date, from, t))
  const prev = txs.filter((x) => inRange(x.date, prevFrom, prevTo))
  const spent = totals(week).expense
  const prevSpent = totals(prev).expense
  const cats = [...spendByCategory(week).entries()].sort((a, b) => b[1] - a[1])
  const perPerson: Record<PersonId, number> = { p1: 0, p2: 0, joint: 0 }
  const spentPerPerson: Record<PersonId, number> = { p1: 0, p2: 0, joint: 0 }
  for (const x of week) {
    if (perPerson[x.personId] === undefined) continue
    perPerson[x.personId]++
    if (x.type === 'expense') spentPerPerson[x.personId] += x.amountCents
  }
  const loggedDays = new Set([
    ...live(data).filter((x) => !x.recurringId).map((x) => x.createdAt && localDay(x.createdAt)),
    ...data.checkins.filter((c) => !c.deleted).map((c) => c.date),
  ].filter((d): d is string => !!d && inRange(d, from, t)))
  const saved = data.goals
    .filter((g) => !g.deleted)
    .flatMap((g) => g.contributions)
    .filter((c) => inRange(c.date, from, t))
    .reduce((s, c) => s + c.amountCents, 0)
  const change = prevSpent > 0 ? (spent - prevSpent) / prevSpent : null
  return { from, to: t, spent, prevSpent, change, topCategory: cats[0], entries: week.length, perPerson, spentPerPerson, loggedDays: loggedDays.size, saved }
}

function localDay(iso: string): ISODate {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
