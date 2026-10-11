import { useSyncExternalStore } from 'react'
import type { AppData, CheckIn, MemberId, PersonId, RecurringRule, SavingsGoal, Settings, Transaction } from '../types'
import { emptyData, normalizeData } from './defaults'
import { LocalStorageRepository, type DataRepository } from './repository'
import { generateRecurring } from '../logic/recurring'
import { newlyEarned } from '../logic/badges'
import { newId, nowISO } from '../logic/id'
import { today } from '../logic/dates'

type Listener = () => void

export interface UiState {
  ready: boolean
  celebrations: string[] // queue of badge ids (or 'goal:<id>') to celebrate
  storageError?: string
}

/**
 * Tiny app store: in-memory state + repository persistence.
 * All mutations go through `commit`, which stamps, persists, generates
 * recurring entries and evaluates badges.
 */
class Store {
  private data: AppData = emptyData()
  private ui: UiState = { ready: false, celebrations: [] }
  private listeners = new Set<Listener>()
  private snapshot = { data: this.data, ui: this.ui }

  private repo: DataRepository
  constructor(repo: DataRepository) {
    this.repo = repo
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.snapshot

  private emit() {
    this.snapshot = { data: this.data, ui: this.ui }
    this.listeners.forEach((l) => l())
  }

  async init() {
    try {
      const loaded = await this.repo.load()
      this.data = loaded ? normalizeData(loaded) : emptyData()
    } catch (e) {
      console.error(e)
      this.data = emptyData()
      this.ui = { ...this.ui, storageError: 'Gespeicherte Daten konnten nicht gelesen werden.' }
    }
    this.ui = { ...this.ui, ready: true }
    this.commit((d) => d, { celebrate: true })
    navigator.storage?.persist?.().catch(() => {})
  }

  /** Re-run recurring generation (e.g. when the app returns to the foreground on a new day). */
  refresh() {
    this.commit((d) => d)
  }

  private commit(mutate: (d: AppData) => AppData, opts: { celebrate?: boolean } = { celebrate: true }) {
    let next = generateRecurring(mutate(this.data)).data
    const earned = newlyEarned(next)
    if (earned.length) {
      const now = nowISO()
      next = { ...next, badges: { ...next.badges, ...Object.fromEntries(earned.map((id) => [id, now])) } }
      if (opts.celebrate) this.ui = { ...this.ui, celebrations: [...this.ui.celebrations, ...earned] }
    }
    this.data = next
    this.repo.save(next).catch((e) => {
      console.error(e)
      this.ui = { ...this.ui, storageError: 'Speichern fehlgeschlagen – bitte Daten exportieren.' }
      this.emit()
    })
    this.emit()
  }

  dismissCelebration() {
    this.ui = { ...this.ui, celebrations: this.ui.celebrations.slice(1) }
    this.emit()
  }
  celebrate(key: string) {
    this.ui = { ...this.ui, celebrations: [...this.ui.celebrations, key] }
    this.emit()
  }

  // ---------- Transactions ----------
  addTransaction(t: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Transaction {
    const now = nowISO()
    const tx: Transaction = { ...t, id: newId(), createdAt: now, updatedAt: now }
    this.commit((d) => ({
      ...d,
      transactions: [...d.transactions, tx],
      settings: { ...d.settings, lastPersonId: t.personId },
    }))
    return tx
  }
  updateTransaction(id: string, patch: Partial<Transaction>) {
    this.commit((d) => ({
      ...d,
      transactions: d.transactions.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: nowISO() } : t)),
    }))
  }
  deleteTransaction(id: string) {
    this.updateTransaction(id, { deleted: true })
  }
  restoreTransaction(id: string) {
    this.updateTransaction(id, { deleted: false })
  }

  // ---------- Check-ins ----------
  checkInNoSpend(personId: MemberId) {
    const now = nowISO()
    const c: CheckIn = { id: newId(), createdAt: now, updatedAt: now, date: today(), personId }
    this.commit((d) => ({ ...d, checkins: [...d.checkins, c] }))
  }

  // ---------- Budgets ----------
  setBudget(categoryId: string, limitCents: number) {
    this.commit((d) => ({
      ...d,
      budgets: { ...d.budgets, [categoryId]: { categoryId, limitCents: Math.max(0, limitCents), updatedAt: nowISO() } },
    }))
  }

  // ---------- Recurring ----------
  saveRecurring(rule: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const now = nowISO()
    this.commit((d) => {
      if (rule.id) {
        return { ...d, recurring: d.recurring.map((r) => (r.id === rule.id ? { ...r, ...rule, id: r.id, updatedAt: now } : r)) }
      }
      return { ...d, recurring: [...d.recurring, { ...rule, id: newId(), createdAt: now, updatedAt: now }] }
    })
  }
  deleteRecurring(id: string) {
    this.commit((d) => ({
      ...d,
      recurring: d.recurring.map((r) => (r.id === id ? { ...r, deleted: true, active: false, updatedAt: nowISO() } : r)),
    }))
  }

  // ---------- Goals ----------
  saveGoal(goal: { id?: string; name: string; emoji: string; targetCents: number }) {
    const now = nowISO()
    this.commit((d) => {
      if (goal.id) return { ...d, goals: d.goals.map((g) => (g.id === goal.id ? withReached({ ...g, ...goal, id: g.id, updatedAt: now }) : g)) }
      const g: SavingsGoal = { ...goal, id: newId(), createdAt: now, updatedAt: now, contributions: [] }
      return { ...d, goals: [...d.goals, g] }
    })
  }
  contribute(goalId: string, personId: PersonId, amountCents: number) {
    const before = this.data.goals.find((g) => g.id === goalId)
    this.commit((d) => ({
      ...d,
      goals: d.goals.map((g) =>
        g.id === goalId
          ? withReached({
              ...g,
              updatedAt: nowISO(),
              contributions: [...g.contributions, { id: newId(), personId, amountCents, date: today() }],
            })
          : g,
      ),
    }))
    const after = this.data.goals.find((g) => g.id === goalId)
    if (before && !before.reachedAt && after?.reachedAt) {
      // Every reached goal gets its own celebration (the badge only fires once).
      if (!this.ui.celebrations.includes('goal_reached')) this.celebrate(`goal:${goalId}`)
    }
  }
  deleteGoal(id: string) {
    this.commit((d) => ({ ...d, goals: d.goals.map((g) => (g.id === id ? { ...g, deleted: true, updatedAt: nowISO() } : g)) }))
  }

  // ---------- Settings ----------
  updateSettings(patch: Partial<Settings>) {
    this.commit((d) => ({ ...d, settings: { ...d.settings, ...patch, updatedAt: nowISO() } }))
  }

  // ---------- Backup ----------
  exportJSON(): string {
    return JSON.stringify({ app: 'ausgaben-app', exportedAt: nowISO(), data: this.data }, null, 2)
  }
  importJSON(text: string) {
    const data = normalizeData(JSON.parse(text))
    this.commit(() => data, { celebrate: false })
  }
  resetAll() {
    this.commit(() => emptyData(), { celebrate: false })
  }
}

function withReached(g: SavingsGoal): SavingsGoal {
  const saved = g.contributions.reduce((s, c) => s + c.amountCents, 0)
  if (saved >= g.targetCents && g.targetCents > 0) return g.reachedAt ? g : { ...g, reachedAt: nowISO() }
  return g.reachedAt ? { ...g, reachedAt: undefined } : g
}

export const goalSaved = (g: SavingsGoal) => g.contributions.reduce((s, c) => s + c.amountCents, 0)

export const store = new Store(new LocalStorageRepository())

export function useStore() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
