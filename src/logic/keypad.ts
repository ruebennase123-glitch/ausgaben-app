/** Applies a keypad key to a German decimal string (max 2 decimals, 7 integer digits). */
export function applyKey(value: string, k: string): string {
  if (k === '⌫') return value.slice(0, -1)
  if (k === 'C') return ''
  if (k === ',') {
    if (value.includes(',')) return value
    return (value || '0') + ','
  }
  const [int, dec] = value.split(',')
  if (dec !== undefined) return dec.length >= 2 ? value : value + k
  if (int.replace(/^0+/, '').length >= 7) return value
  if (value === '0') return k
  return value + k
}
