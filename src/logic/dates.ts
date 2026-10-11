import type { ISODate, MonthKey } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function today(): ISODate {
  return toISODate(new Date())
}
export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function addDays(s: ISODate, days: number): ISODate {
  const d = parseISODate(s)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}
export function monthOf(s: ISODate): MonthKey {
  return s.slice(0, 7)
}
export function currentMonth(): MonthKey {
  return monthOf(today())
}
export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
export function daysInMonth(m: MonthKey): number {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo, 0).getDate()
}
export function localDateOfTimestamp(iso: string): ISODate {
  return toISODate(new Date(iso))
}

const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })
export function formatMonth(m: MonthKey): string {
  const [y, mo] = m.split('-').map(Number)
  return monthFmt.format(new Date(y, mo - 1, 1))
}

const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
const shortFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' })
export function formatDayHeading(s: ISODate): string {
  const t = today()
  if (s === t) return 'Heute'
  if (s === addDays(t, -1)) return 'Gestern'
  return dayFmt.format(parseISODate(s))
}
export function formatShortDate(s: ISODate): string {
  if (s === today()) return 'Heute'
  if (s === addDays(today(), -1)) return 'Gestern'
  return shortFmt.format(parseISODate(s))
}
