// Central data model. Every syncable record carries `id`, `updatedAt` and a
// soft-delete flag (`deleted`) so a later sync backend (e.g. Supabase) can
// merge changes per record with "last write wins" and propagate deletions.

export type ID = string
export type ISODate = string // YYYY-MM-DD (local date)
export type ISODateTime = string // full ISO timestamp
export type MonthKey = string // YYYY-MM
export type TxType = 'expense' | 'income'
/** The two partners. */
export type MemberId = 'p1' | 'p2'
/** Who paid / owns a record: one of the partners or the joint account (Gemeinschaftskonto). */
export type PersonId = MemberId | 'joint'

export interface SyncMeta {
  id: ID
  createdAt: ISODateTime
  updatedAt: ISODateTime
  deleted?: boolean
}

export interface Category {
  id: string
  name: string
  emoji: string
  type: TxType
  color: string
  /** Retired: not offered in pickers; old records are migrated to `mergedInto`. */
  mergedInto?: string
}

export interface Person {
  id: PersonId
  name: string
  emoji: string
}

export interface Transaction extends SyncMeta {
  type: TxType
  amountCents: number // always positive
  categoryId: string
  personId: PersonId
  note?: string
  date: ISODate
  recurringId?: ID // set when auto-generated from a recurring rule
}

export type IntervalMonths = 1 | 3 | 6 | 12

export interface RecurringRule extends SyncMeta {
  type: TxType
  amountCents: number
  categoryId: string
  personId: PersonId
  note: string
  dayOfMonth: number // 1..31 (clamped to month length)
  /** Months between bookings: 1 monatlich, 3 vierteljährlich, 6 halbjährlich, 12 jährlich. Missing = 1 (older data). */
  intervalMonths?: IntervalMonths
  startMonth: MonthKey
  active: boolean
}

export interface GoalContribution {
  id: ID
  personId: PersonId
  amountCents: number
  date: ISODate
}

export interface SavingsGoal extends SyncMeta {
  name: string
  emoji: string
  targetCents: number
  contributions: GoalContribution[]
  reachedAt?: ISODateTime
}

/** "Heute nichts ausgegeben" check-in, keeps the logging streak alive. */
export interface CheckIn extends SyncMeta {
  date: ISODate
  personId: MemberId
}

export interface Settings {
  persons: [Person, Person]
  /** Joint account as third payer (added in v1.1; filled with defaults for older data). */
  joint: Person
  theme: 'system' | 'light' | 'dark'
  lastPersonId: PersonId
  updatedAt: ISODateTime
  /** Last change of the household-shared part (persons, joint) – LWW key for sync. */
  sharedUpdatedAt?: ISODateTime
}

export interface BudgetEntry {
  categoryId: string
  limitCents: number
  updatedAt: ISODateTime
}

export interface AppData {
  schemaVersion: 1
  transactions: Transaction[]
  recurring: RecurringRule[]
  goals: SavingsGoal[]
  checkins: CheckIn[]
  budgets: Record<string, BudgetEntry> // key = categoryId
  badges: Record<string, ISODateTime> // badgeId -> earnedAt
  settings: Settings
}
