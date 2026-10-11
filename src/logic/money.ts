const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const eurRound = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function formatEUR(cents: number): string {
  return eur.format(cents / 100)
}
/** Rounded to whole euros – for compact labels. */
export function formatEURShort(cents: number): string {
  return eurRound.format(Math.round(cents / 100))
}
/** Parse German input like "12,5" or "1.234,56" into cents. */
export function parseEURInput(s: string): number {
  const clean = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = Number.parseFloat(clean)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
/** Cents -> keypad string ("12,50" -> "12,5" stays editable). */
export function centsToInput(cents: number): string {
  const s = (cents / 100).toFixed(2).replace('.', ',')
  return s.endsWith(',00') ? s.slice(0, -3) : s
}
