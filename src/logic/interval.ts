import type { IntervalMonths, ISODate, MonthKey, RecurringRule } from '../types'
import { addMonths, currentMonth, daysInMonth, today } from './dates'

export const INTERVALS: { value: IntervalMonths; label: string; short: string; per: string }[] = [
  { value: 1, label: 'Monatlich', short: 'monatlich', per: '' },
  { value: 3, label: 'Quartal', short: 'vierteljährlich', per: '/ Quartal' },
  { value: 6, label: 'Halbjährl.', short: 'halbjährlich', per: '/ Halbjahr' },
  { value: 12, label: 'Jährlich', short: 'jährlich', per: '/ Jahr' },
]
export const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

export const intervalOf = (r: Pick<RecurringRule, 'intervalMonths'>): IntervalMonths => r.intervalMonths ?? 1
export const intervalInfo = (n: IntervalMonths) => INTERVALS.find((i) => i.value === n)!

const idx = (m: MonthKey) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1

/** Is month m a due month of the rule (on/after its start, in the interval's rhythm)? */
export function isDueMonth(r: Pick<RecurringRule, 'intervalMonths' | 'startMonth'>, m: MonthKey): boolean {
  const d = idx(m) - idx(r.startMonth)
  return d >= 0 && d % intervalOf(r) === 0
}

export function bookingDate(m: MonthKey, dayOfMonth: number): ISODate {
  return `${m}-${String(Math.min(dayOfMonth, daysInMonth(m))).padStart(2, '0')}`
}

/** First due month ≥ from that falls into the rhythm of month-of-year `dueMonth` (1..12). */
export function alignStart(dueMonth: number, n: IntervalMonths, from: MonthKey = currentMonth()): MonthKey {
  let m = `${from.slice(0, 4)}-${String(dueMonth).padStart(2, '0')}`
  while (idx(m) > idx(from)) m = addMonths(m, -n)
  while (idx(m) < idx(from)) m = addMonths(m, n)
  return m
}

/** Next booking date on or after today (today counts). */
export function nextDue(r: RecurringRule, t: ISODate = today()): ISODate {
  const n = intervalOf(r)
  let m = r.startMonth
  const cm = t.slice(0, 7)
  if (idx(m) < idx(cm)) m = addMonths(m, Math.ceil((idx(cm) - idx(m)) / n) * n)
  let d = bookingDate(m, r.dayOfMonth)
  if (d < t) d = bookingDate((m = addMonths(m, n)), r.dayOfMonth)
  return d
}

/** Amount per month (e.g. yearly / 12), rounded to cents. */
export const monthlyEquivalent = (r: RecurringRule) => Math.round(r.amountCents / intervalOf(r))
