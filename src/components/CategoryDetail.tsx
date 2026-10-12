import { useMemo } from 'react'
import type { MonthKey, PersonId, Transaction } from '../types'
import { useStore } from '../data/store'
import { getCategory } from '../data/categories'
import { addMonths, formatDayHeading, formatMonth } from '../logic/dates'
import { formatEUR } from '../logic/money'
import { budgetStatus, live, totals } from '../logic/stats'
import { Progress } from './ui'
import { IconChevron, IconRepeat } from './Icons'
import { payers } from '../data/people'

const monthShort = new Intl.DateTimeFormat('de-DE', { month: 'short' })

/** Full-screen category page (pushed onto history so iPhone swipe-back / browser back closes it). */
export function CategoryDetail({ categoryId, month, person, onBack, onEdit }: {
  categoryId: string; month: MonthKey; person: 'all' | PersonId; onBack: () => void; onEdit: (tx: Transaction) => void
}) {
  const { data } = useStore()
  const c = getCategory(categoryId)
  const persons = payers(data.settings)
  const all = useMemo(() => live(data).filter((t) => person === 'all' || t.personId === person), [data, person])
  const sumFor = (m: MonthKey) => all.filter((t) => t.type === c.type && t.categoryId === categoryId && t.date.startsWith(m)).reduce((s, t) => s + t.amountCents, 0)
  const entries = all
    .filter((t) => t.categoryId === categoryId && t.date.startsWith(month))
    .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
  const total = sumFor(month)
  const monthTotals = totals(all.filter((t) => t.date.startsWith(month)))
  const base = c.type === 'income' ? monthTotals.income : monthTotals.expense
  const share = base > 0 ? total / base : 0
  const prev = sumFor(addMonths(month, -1))
  const diff = total - prev
  const trend = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5)).map((m) => ({ m, v: sumFor(m) }))
  const maxV = Math.max(1, ...trend.map((x) => x.v))
  const budget = c.type === 'expense' ? data.budgets[categoryId] : undefined
  // Budgets apply to the whole household (like in Planen), independent of the person filter
  const householdSpent = live(data).filter((t) => t.type === 'expense' && t.categoryId === categoryId && t.date.startsWith(month)).reduce((s, t) => s + t.amountCents, 0)
  const st = budget && budget.limitCents > 0 ? budgetStatus(householdSpent, budget.limitCents) : null
  const who = person === 'all' ? 'Beide' : persons.find((p) => p.id === person)?.name

  return (
    <div className="detail-page" role="dialog" aria-modal="true" aria-label={`Kategorie ${c.name}`}>
      <header className="detail-top">
        <button type="button" className="back-btn" onClick={onBack} aria-label="Zurück zur Übersicht">
          <IconChevron dir="left" /> Übersicht
        </button>
      </header>
      <div className="detail-head">
        <span className="detail-icon" style={{ background: `color-mix(in srgb, ${c.color} 22%, transparent)` }}>{c.emoji}</span>
        <div>
          <h1>{c.name}</h1>
          <div className="muted small-text">{formatMonth(month)} · {who}</div>
        </div>
      </div>

      <section className="card detail-stats">
        <div className="detail-total">{formatEUR(total)}</div>
        <div className="detail-grid">
          <div><small>Anteil {c.type === 'income' ? 'Einnahmen' : 'Ausgaben'}</small><b>{Math.round(share * 100)} %</b></div>
          <div>
            <small>Vormonat</small>
            <b className={diff > 0 && c.type === 'expense' ? 'trend-up' : diff < 0 && c.type === 'expense' ? 'trend-down' : ''}>
              {prev === 0 && total === 0 ? '–' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${formatEUR(Math.abs(diff))}`}
            </b>
            <small>{prev > 0 ? `${diff >= 0 ? '+' : '−'}${Math.round(Math.abs(diff / prev) * 100)} % · vorher ${formatEUR(prev)}` : 'kein Vormonatswert'}</small>
          </div>
        </div>
        {st && budget && (
          <div className="detail-budget">
            <div className="detail-budget-line">
              <span>Budget {formatEUR(budget.limitCents)}{person !== 'all' ? ' (gesamt)' : ''}</span>
              <b className={st.level === 'over' ? 'neg' : ''}>{st.level === 'over' ? `${formatEUR(-st.remaining)} drüber` : `${formatEUR(st.remaining)} übrig`}</b>
            </div>
            <Progress ratio={st.ratio} level={st.level} />
          </div>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">Letzte 6 Monate</h3>
        <div className="bars" role="img" aria-label={trend.map((x) => `${formatMonth(x.m)}: ${formatEUR(x.v)}`).join(', ')}>
          {trend.map((x) => (
            <div key={x.m} className={`bar-col ${x.m === month ? 'current' : ''}`}>
              <span className="bar-val">{x.v > 0 ? Math.round(x.v / 100) : ''}</span>
              <div className="bar" style={{ height: `${Math.max(x.v > 0 ? 4 : 0, (x.v / maxV) * 100)}%`, background: c.color }} />
              <span className="bar-label">{monthShort.format(new Date(`${x.m}-15T12:00:00`)).replace('.', '')}</span>
            </div>
          ))}
        </div>
      </section>

      <h3 className="section-title">{entries.length} {entries.length === 1 ? 'Buchung' : 'Buchungen'}</h3>
      {entries.length === 0 ? (
        <p className="hint">Keine Buchungen in diesem Monat.</p>
      ) : (
        <div className="card tx-card">
          {entries.map((tx) => {
            const p = persons.find((x) => x.id === tx.personId)
            return (
              <button key={tx.id} type="button" className="tx-row" onClick={() => onEdit(tx)}>
                <span className="tx-icon" style={{ background: `color-mix(in srgb, ${c.color} 18%, transparent)` }}>{c.emoji}</span>
                <span className="tx-main">
                  <span className="tx-title">
                    {tx.note || c.name}
                    {tx.recurringId && <span className="tag"><IconRepeat size={11} /> fix</span>}
                  </span>
                  <span className="tx-sub">{formatDayHeading(tx.date)} · {p?.emoji} {p?.name}</span>
                </span>
                <span className={`tx-amount ${tx.type}`}>{tx.type === 'income' ? '+' : '−'}{formatEUR(tx.amountCents)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
