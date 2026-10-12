import { useEffect, type ReactNode } from 'react'
import type { Category, Person, PersonId } from '../types'
import { IconBackspace, IconChevron } from './Icons'
import { formatMonth } from '../logic/dates'

export function Keypad({ onKey }: { onKey: (k: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']
  return (
    <div className="keypad" role="group" aria-label="Betrag eingeben">
      {keys.map((k) => (
        <button key={k} type="button" className="key" onClick={() => onKey(k)} aria-label={k === '⌫' ? 'Letzte Ziffer löschen' : k}>
          {k === '⌫' ? <IconBackspace size={26} /> : k}
        </button>
      ))}
    </div>
  )
}

export function CategoryChips({ categories, value, onChange }: { categories: Category[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="Kategorie">
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          className={`chip ${value === c.id ? 'active' : ''}`}
          aria-label={c.name}
          data-name={c.name}
          style={{ ['--c' as string]: c.color }}
          onClick={() => onChange(c.id)}
        >
          <span className="chip-emoji">{c.emoji}</span>
          <span className="chip-label">{chipLabel(c.name)}</span>
        </button>
      ))}
    </div>
  )
}

export function PersonPicker({ persons, value, onChange, small }: { persons: Person[]; value: PersonId; onChange: (p: PersonId) => void; small?: boolean }) {
  return (
    <div className={`segmented stacked ${small ? 'small' : ''}`} role="radiogroup" aria-label="Person">
      {persons.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={value === p.id} className={value === p.id ? 'active' : ''} onClick={() => onChange(p.id)}>
          <span className="seg-emoji">{p.emoji}</span>
          <span className="seg-label">{p.name}</span>
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, className = '' }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`segmented ${className}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function MonthSwitcher({ month, onChange, max }: { month: string; onChange: (m: string) => void; max?: string }) {
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const next = shift(1)
  return (
    <div className="month-switcher">
      <button type="button" className="icon-btn" onClick={() => onChange(shift(-1))} aria-label="Vorheriger Monat">
        <IconChevron dir="left" />
      </button>
      <span className="month-label">{formatMonth(month)}</span>
      <button type="button" className="icon-btn" onClick={() => onChange(next)} disabled={!!max && next > max} aria-label="Nächster Monat">
        <IconChevron />
      </button>
    </div>
  )
}

export function Progress({ ratio, level = 'ok', color }: { ratio: number; level?: 'ok' | 'warn' | 'over' | 'goal'; color?: string }) {
  return (
    <div className={`progress ${level}`} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(ratio > 0 ? 3 : 0, ratio * 100))}%`, background: color }} />
    </div>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="text-btn" onClick={onClose}>Schließen</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

export function Donut({ data, size = 168, thickness = 22, center, onSelect }: { data: { value: number; color: string; key: string; label?: string }[]; size?: number; thickness?: number; center?: ReactNode; onSelect?: (key: string) => void }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const gap = data.length > 1 ? 3 : 0
  let offset = 0
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden={!onSelect}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={thickness} />
        {total > 0 &&
          data.map((d) => {
            const len = (d.value / total) * c
            const el = (
              <circle
                key={d.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                data-key={d.key}
                className={onSelect ? 'donut-slice' : undefined}
                onClick={onSelect ? () => onSelect(d.key) : undefined}
              >
                {d.label && <title>{d.label}</title>}
              </circle>
            )
            offset += len
            return el
          })}
      </svg>
      <div className="donut-center">{center}</div>
    </div>
  )
}

export function Empty({ emoji, title, text }: { emoji: string; title: string; text?: string }) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
    </div>
  )
}

// Explicit break opportunities for the narrow chip grid (CSS hyphenation is not available everywhere)
const SOFT: Record<string, string> = {
  Restaurant: 'Restau\u00adrant', Gesundheit: 'Gesund\u00adheit', Renovieren: 'Reno\u00advieren',
  Geschenke: 'Ge\u00adschenke', Lieferando: 'Liefe\u00adrando', Rücklagen: 'Rück\u00adlagen', Mobilität: 'Mobi\u00adlität', Versicherungen: 'Versiche\u00adrungen',
}
function chipLabel(name: string): string {
  return name.replace(/\//g, '/\u200b').replace(/[A-Za-zÄÖÜäöüß]+/g, (w) => SOFT[w] ?? w)
}
