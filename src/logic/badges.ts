import type { AppData } from '../types'
import { currentMonth } from './dates'
import { live, spendByCategory, txOfMonth } from './stats'
import { loggedDays, longestStreak } from './streaks'

export interface BadgeDef {
  id: string
  emoji: string
  title: string
  description: string
  check: (d: AppData) => boolean
}

const manual = (d: AppData) => live(d).filter((t) => !t.recurringId)

/** A past month counts as "under budget" when budgets exist, the month has expenses and no budget was exceeded. */
export function monthUnderBudget(d: AppData, month: string): boolean {
  const budgets = Object.values(d.budgets).filter((b) => b.limitCents > 0)
  if (!budgets.length) return false
  const txs = txOfMonth(d, month)
  if (!txs.some((t) => t.type === 'expense')) return false
  const spent = spendByCategory(txs)
  return budgets.every((b) => (spent.get(b.categoryId) ?? 0) <= b.limitCents)
}

function anyPastMonthUnderBudget(d: AppData): boolean {
  const months = new Set(live(d).map((t) => t.date.slice(0, 7)))
  const cm = currentMonth()
  return [...months].some((m) => m < cm && monthUnderBudget(d, m))
}

function bothLoggedSameWeek(d: AppData): boolean {
  const a = loggedDays(d, 'p1')
  const b = [...loggedDays(d, 'p2')]
  // any p2 day within ±3 days of a p1 day
  return b.some((day) => {
    const t = new Date(day).getTime()
    return [...a].some((x) => Math.abs(new Date(x).getTime() - t) <= 3 * 864e5)
  })
}

export const BADGES: BadgeDef[] = [
  { id: 'first_entry', emoji: '🌱', title: 'Erster Eintrag', description: 'Die erste Buchung erfasst.', check: (d) => manual(d).length >= 1 },
  { id: 'streak_3', emoji: '🔥', title: '3 Tage am Stück', description: '3 Tage hintereinander etwas eingetragen.', check: (d) => longestStreak(loggedDays(d)) >= 3 },
  { id: 'streak_7', emoji: '⚡', title: '7-Tage-Serie', description: 'Eine ganze Woche lang jeden Tag eingetragen.', check: (d) => longestStreak(loggedDays(d)) >= 7 },
  { id: 'streak_30', emoji: '🏆', title: '30-Tage-Serie', description: 'Einen Monat lang jeden Tag dabei.', check: (d) => longestStreak(loggedDays(d)) >= 30 },
  { id: 'team', emoji: '🤝', title: 'Teamwork', description: 'Ihr habt beide in derselben Woche eingetragen.', check: bothLoggedSameWeek },
  { id: 'entries_50', emoji: '📒', title: 'Buchhalter-Profi', description: '50 Einträge erfasst.', check: (d) => manual(d).length >= 50 },
  { id: 'no_spend', emoji: '🧘', title: 'Sparsamer Tag', description: 'Einen Tag ohne Ausgaben eingecheckt.', check: (d) => d.checkins.some((c) => !c.deleted) },
  { id: 'budget_set', emoji: '🧭', title: 'Plan gemacht', description: 'Das erste Budget festgelegt.', check: (d) => Object.values(d.budgets).some((b) => b.limitCents > 0) },
  { id: 'month_budget', emoji: '✅', title: 'Monat im Budget', description: 'Einen ganzen Monat alle Budgets eingehalten.', check: anyPastMonthUnderBudget },
  { id: 'first_goal', emoji: '🐷', title: 'Gemeinsames Ziel', description: 'Das erste Sparziel angelegt.', check: (d) => d.goals.some((g) => !g.deleted) },
  { id: 'goal_reached', emoji: '🎯', title: 'Ziel erreicht!', description: 'Ein Sparziel vollständig erreicht.', check: (d) => d.goals.some((g) => !g.deleted && !!g.reachedAt) },
]

export function badgeById(id: string) {
  return BADGES.find((b) => b.id === id)
}

/** Returns ids of badges newly earned in `data` (not yet in data.badges). */
export function newlyEarned(data: AppData): string[] {
  return BADGES.filter((b) => !data.badges[b.id] && b.check(data)).map((b) => b.id)
}

