// Pure mapping/merge functions between the local AppData model and Supabase rows.
import type { AppData, Budgets, CheckIn, GoalContribution, PersonId, RecurringRule, SavingsGoal, Transaction } from './types-local'
import { isUuid } from '../logic/uuid5'
import { newId, nowISO } from '../logic/id'

/** Timestamp -> epoch ms. Normalises Postgres microseconds for Safari. */
export function ts(s: string | null | undefined): number {
  if (!s) return 0
  const n = Date.parse(s.replace(/(\.\d{3})\d+/, '$1').replace(' ', 'T'))
  return Number.isFinite(n) ? n : 0
}
const iso = (s: string) => new Date(ts(s)).toISOString()

export type Row = Record<string, unknown>
export interface RemoteBatch {
  household?: { settings: { persons?: AppData['settings']['persons']; joint?: AppData['settings']['joint'] }; settings_updated_at: string }
  transactions: Row[]
  recurring_rules: Row[]
  savings_goals: Row[]
  goal_contributions: Row[]
  budgets: Row[]
  checkins: Row[]
  badges: Row[]
}
export type Versions = Record<string, number>

// ---------- local -> row ----------
export const txRow = (t: Transaction, hid: string): Row => ({
  id: t.id, household_id: hid, type: t.type, amount_cents: t.amountCents, category_id: t.categoryId, person_id: t.personId,
  note: t.note ?? null, date: t.date, recurring_id: t.recurringId ?? null, created_at: t.createdAt, updated_at: t.updatedAt, deleted: !!t.deleted,
})
export const ruleRow = (r: RecurringRule, hid: string): Row => ({
  id: r.id, household_id: hid, type: r.type, amount_cents: r.amountCents, category_id: r.categoryId, person_id: r.personId, note: r.note,
  day_of_month: r.dayOfMonth, start_month: r.startMonth, active: r.active, created_at: r.createdAt, updated_at: r.updatedAt, deleted: !!r.deleted,
})
export const goalRow = (g: SavingsGoal, hid: string): Row => ({
  id: g.id, household_id: hid, name: g.name, emoji: g.emoji, target_cents: g.targetCents, reached_at: g.reachedAt ?? null,
  created_at: g.createdAt, updated_at: g.updatedAt, deleted: !!g.deleted,
})
export const contribRow = (c: GoalContribution, goalId: string, hid: string): Row => ({
  id: c.id, household_id: hid, goal_id: goalId, person_id: c.personId, amount_cents: c.amountCents, date: c.date,
  updated_at: new Date(`${c.date}T12:00:00Z`).toISOString(), deleted: false,
})
export const checkinRow = (c: CheckIn, hid: string): Row => ({
  id: c.id, household_id: hid, person_id: c.personId, date: c.date, created_at: c.createdAt, updated_at: c.updatedAt, deleted: !!c.deleted,
})
export const budgetRow = (categoryId: string, b: Budgets[string], hid: string): Row => ({
  household_id: hid, category_id: categoryId, limit_cents: b.limitCents, updated_at: b.updatedAt, deleted: false,
})
export const badgeRow = (id: string, earnedAt: string, hid: string): Row => ({
  household_id: hid, badge_id: id, earned_at: earnedAt, updated_at: earnedAt, deleted: false,
})

// ---------- row -> local ----------
const txFrom = (r: Row): Transaction => ({
  id: r.id as string, type: r.type as Transaction['type'], amountCents: r.amount_cents as number, categoryId: r.category_id as string,
  personId: r.person_id as PersonId, note: (r.note as string | null) ?? undefined, date: r.date as string,
  recurringId: (r.recurring_id as string | null) ?? undefined, createdAt: iso(r.created_at as string), updatedAt: iso(r.updated_at as string),
  ...(r.deleted ? { deleted: true } : {}),
})
const ruleFrom = (r: Row): RecurringRule => ({
  id: r.id as string, type: r.type as RecurringRule['type'], amountCents: r.amount_cents as number, categoryId: r.category_id as string,
  personId: r.person_id as PersonId, note: (r.note as string) ?? '', dayOfMonth: r.day_of_month as number, startMonth: r.start_month as string,
  active: r.active as boolean, createdAt: iso(r.created_at as string), updatedAt: iso(r.updated_at as string), ...(r.deleted ? { deleted: true } : {}),
})
const checkinFrom = (r: Row): CheckIn => ({
  id: r.id as string, personId: r.person_id as CheckIn['personId'], date: r.date as string, createdAt: iso(r.created_at as string),
  updatedAt: iso(r.updated_at as string), ...(r.deleted ? { deleted: true } : {}),
})

function lww<T extends { id: string; updatedAt: string }>(local: T[], rows: Row[], from: (r: Row) => T, prefix: string, versions: Versions) {
  if (!rows.length) return local
  const map = new Map(local.map((x) => [x.id, x]))
  let changed = false
  for (const row of rows) {
    const rec = from(row)
    const cur = map.get(rec.id)
    const rv = ts(rec.updatedAt)
    if (!cur || rv > ts(cur.updatedAt)) {
      map.set(rec.id, rec)
      changed = true
      versions[`${prefix}:${rec.id}`] = rv
    } else if (rv === ts(cur.updatedAt)) {
      versions[`${prefix}:${rec.id}`] = rv
    }
  }
  return changed ? [...map.values()] : local
}

/** Merge a batch of remote rows into local data (last write wins per record). Mutates `versions`. */
export function mergeRemote(data: AppData, b: RemoteBatch, versions: Versions): AppData {
  let d = data
  const transactions = lww(d.transactions, b.transactions, txFrom, 'tx', versions)
  const recurring = lww(d.recurring, b.recurring_rules, ruleFrom, 'rule', versions)
  const checkins = lww(d.checkins, b.checkins, checkinFrom, 'checkin', versions)

  // Goals: LWW on goal fields, contributions are an append-only union
  let goals = d.goals
  if (b.savings_goals.length || b.goal_contributions.length) {
    const map = new Map(goals.map((g) => [g.id, g]))
    for (const r of b.savings_goals) {
      const cur = map.get(r.id as string)
      const rv = ts(r.updated_at as string)
      if (!cur || rv > ts(cur.updatedAt)) {
        map.set(r.id as string, {
          id: r.id as string, name: r.name as string, emoji: r.emoji as string, targetCents: r.target_cents as number,
          reachedAt: (r.reached_at as string | null) ? iso(r.reached_at as string) : undefined,
          createdAt: iso(r.created_at as string), updatedAt: iso(r.updated_at as string),
          contributions: cur?.contributions ?? [], ...(r.deleted ? { deleted: true } : {}),
        })
      }
      if (!cur || rv >= ts(cur.updatedAt)) versions[`goal:${r.id}`] = rv
    }
    for (const r of b.goal_contributions) {
      const g = map.get(r.goal_id as string)
      versions[`contrib:${r.id}`] = 1
      if (!g || g.contributions.some((c) => c.id === r.id) || r.deleted) continue
      map.set(g.id, {
        ...g,
        contributions: [...g.contributions, { id: r.id as string, personId: r.person_id as PersonId, amountCents: r.amount_cents as number, date: r.date as string }],
      })
    }
    goals = [...map.values()].map((g) => {
      const saved = g.contributions.reduce((s, c) => s + c.amountCents, 0)
      const reached = g.targetCents > 0 && saved >= g.targetCents
      return reached === !!g.reachedAt ? g : { ...g, reachedAt: reached ? nowISO() : undefined }
    })
  }

  let budgets = d.budgets
  if (b.budgets.length) {
    budgets = { ...budgets }
    for (const r of b.budgets) {
      const cat = r.category_id as string
      const rv = ts(r.updated_at as string)
      const cur = budgets[cat]
      if (!cur || rv > ts(cur.updatedAt)) budgets[cat] = { categoryId: cat, limitCents: r.deleted ? 0 : (r.limit_cents as number), updatedAt: iso(r.updated_at as string) }
      if (!cur || rv >= ts(cur.updatedAt)) versions[`budget:${cat}`] = rv
    }
  }

  let badges = d.badges
  if (b.badges.length) {
    badges = { ...badges }
    for (const r of b.badges) {
      const id = r.badge_id as string
      const at = iso(r.earned_at as string)
      if (!badges[id] || ts(at) < ts(badges[id])) badges[id] = at
      versions[`badge:${id}`] = 1
    }
  }

  let settings = d.settings
  if (b.household) {
    const rv = ts(b.household.settings_updated_at)
    const s = b.household.settings ?? {}
    if (rv > ts(settings.sharedUpdatedAt) && (s.persons || s.joint)) {
      settings = { ...settings, ...(s.persons ? { persons: s.persons } : {}), ...(s.joint ? { joint: s.joint } : {}), sharedUpdatedAt: new Date(rv).toISOString() }
      versions.settings = rv
    } else if (rv === ts(settings.sharedUpdatedAt)) versions.settings = rv
  }

  d = { ...d, transactions, recurring, checkins, goals, budgets, badges, settings }
  return d
}

/** Replace non-UUID ids (e.g. very old data) so records can be stored server-side. */
export function ensureUuids(d: AppData): AppData {
  const ruleMap = new Map<string, string>()
  const fix = (id: string) => (isUuid(id) ? id : newId())
  const recurring = d.recurring.map((r) => {
    const id = fix(r.id)
    if (id !== r.id) ruleMap.set(r.id, id)
    return { ...r, id }
  })
  return {
    ...d,
    recurring,
    transactions: d.transactions.map((t) => ({ ...t, id: fix(t.id), recurringId: t.recurringId ? (ruleMap.get(t.recurringId) ?? t.recurringId) : undefined })),
    goals: d.goals.map((g) => ({ ...g, id: fix(g.id), contributions: g.contributions.map((c) => ({ ...c, id: fix(c.id) })) })),
    checkins: d.checkins.map((c) => ({ ...c, id: fix(c.id) })),
  }
}

/** Swap person 1 and person 2 (used when the joining partner's local "Ich" becomes slot p2). */
export function swapPersons(d: AppData): AppData {
  const sw = <T extends PersonId>(p: T): T => (p === 'p1' ? 'p2' : p === 'p2' ? 'p1' : p) as T
  const now = nowISO()
  const [a, b] = d.settings.persons
  return {
    ...d,
    transactions: d.transactions.map((t) => (t.personId === 'joint' ? t : { ...t, personId: sw(t.personId), updatedAt: now })),
    recurring: d.recurring.map((r) => (r.personId === 'joint' ? r : { ...r, personId: sw(r.personId), updatedAt: now })),
    checkins: d.checkins.map((c) => ({ ...c, personId: sw(c.personId), updatedAt: now })),
    goals: d.goals.map((g) => ({ ...g, contributions: g.contributions.map((c) => ({ ...c, personId: sw(c.personId) })) })),
    settings: {
      ...d.settings,
      persons: [{ ...b, id: 'p1' }, { ...a, id: 'p2' }],
      lastPersonId: sw(d.settings.lastPersonId),
    },
  }
}

/** Number of user-visible records (to decide whether to offer a merge). */
export function localRecordCount(d: AppData): number {
  return d.transactions.filter((t) => !t.deleted).length + d.recurring.filter((r) => !r.deleted).length + d.goals.filter((g) => !g.deleted).length
}
