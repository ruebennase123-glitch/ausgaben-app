import { useMemo, useState } from 'react'
import type { PersonId, Transaction } from '../types'
import { useStore } from '../data/store'
import { getCategory } from '../data/categories'
import { currentMonth, formatDayHeading } from '../logic/dates'
import { formatEUR, formatEURShort } from '../logic/money'
import { budgetStatus, spendByCategory, totals, txOfMonth } from '../logic/stats'
import { Donut, Empty, MonthSwitcher, Segmented, Sheet } from '../components/ui'
import { EntryForm } from '../components/EntryForm'
import { IconRepeat } from '../components/Icons'
import { RecapCard } from '../components/RecapCard'

export function OverviewScreen() {
  const { data } = useStore()
  const [month, setMonth] = useState(currentMonth())
  const [person, setPerson] = useState<'all' | PersonId>('all')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const txs = useMemo(() => txOfMonth(data, month, person === 'all' ? undefined : person), [data, month, person])
  const t = totals(txs)
  const byCat = [...spendByCategory(txs).entries()].sort((a, b) => b[1] - a[1])
  const persons = data.settings.persons

  const warnings = Object.values(data.budgets)
    .filter((b) => b.limitCents > 0)
    .map((b) => ({ b, st: budgetStatus(spendByCategory(txOfMonth(data, month)).get(b.categoryId) ?? 0, b.limitCents) }))
    .filter((x) => x.st.level !== 'ok')

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const tx of txs) m.set(tx.date, [...(m.get(tx.date) ?? []), tx])
    return [...m.entries()]
  }, [txs])

  return (
    <div className="screen">
      <header className="topbar">
        <h1>Übersicht</h1>
      </header>
      <MonthSwitcher month={month} onChange={setMonth} max={currentMonth()} />
      <Segmented
        className="small person-filter"
        value={person}
        onChange={setPerson}
        options={[{ value: 'all', label: 'Beide' }, ...persons.map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` }))]}
      />

      <section className={`card balance-card ${t.balance < 0 ? 'neg' : ''}`}>
        <div className="balance-label">Saldo {month === currentMonth() ? 'diesen Monat' : ''}</div>
        <div className="balance-value">{t.balance > 0 ? '+' : ''}{formatEUR(t.balance)}</div>
        <div className="balance-row">
          <div>
            <span className="dot income" /> Einnahmen
            <b>{formatEUR(t.income)}</b>
          </div>
          <div>
            <span className="dot expense" /> Ausgaben
            <b>{formatEUR(t.expense)}</b>
          </div>
        </div>
      </section>

      {warnings.length > 0 && (
        <section className="card warn-card">
          {warnings.map(({ b, st }) => {
            const c = getCategory(b.categoryId)
            return (
              <div key={b.categoryId} className={`warn-line ${st.level}`}>
                {st.level === 'over' ? '⚠️' : '⏳'} <b>{c.emoji} {c.name}</b>{' '}
                {st.level === 'over' ? `${formatEUR(-st.remaining)} über Budget` : `nur noch ${formatEUR(st.remaining)} übrig`}
              </div>
            )
          })}
        </section>
      )}

      <section className="card">
        <h3 className="card-title">Ausgaben nach Kategorie</h3>
        {byCat.length === 0 ? (
          <Empty emoji="🌤️" title="Noch keine Ausgaben" text="Sobald ihr etwas eintragt, seht ihr hier die Verteilung." />
        ) : (
          <div className="chart-row">
            <Donut
              size={128}
              thickness={18}
              data={byCat.map(([id, v]) => ({ key: id, value: v, color: getCategory(id).color }))}
              center={
                <>
                  <small>Ausgaben</small>
                  <b>{formatEURShort(t.expense)}</b>
                </>
              }
            />
            <ul className="legend">
              {byCat.slice(0, 6).map(([id, v]) => {
                const c = getCategory(id)
                return (
                  <li key={id}>
                    <span className="dot" style={{ background: c.color }} />
                    <span className="legend-name">{c.emoji} {c.name}</span>
                    <span className="legend-val">{formatEURShort(v)}</span>
                  </li>
                )
              })}
              {byCat.length > 6 && (
                <li className="muted">
                  <span className="dot" style={{ background: 'var(--track)' }} />
                  <span className="legend-name">+{byCat.length - 6} weitere</span>
                  <span className="legend-val">{formatEURShort(byCat.slice(6).reduce((s, [, v]) => s + v, 0))}</span>
                </li>
              )}
            </ul>
          </div>
        )}
      </section>

      {month === currentMonth() && <RecapCard compact />}

      <section className="tx-list">
        <h3 className="section-title">Buchungen</h3>
        {groups.length === 0 && <Empty emoji="🧾" title="Keine Buchungen in diesem Monat" />}
        {groups.map(([date, list]) => (
          <div key={date} className="tx-group">
            <div className="tx-day">
              <span>{formatDayHeading(date)}</span>
              <span>{formatEUR(list.reduce((s, x) => s + (x.type === 'income' ? x.amountCents : -x.amountCents), 0))}</span>
            </div>
            <div className="card tx-card">
              {list.map((tx) => {
                const c = getCategory(tx.categoryId)
                const p = persons.find((x) => x.id === tx.personId)
                return (
                  <button key={tx.id} type="button" className="tx-row" onClick={() => setEditing(tx)}>
                    <span className="tx-icon" style={{ background: `color-mix(in srgb, ${c.color} 18%, transparent)` }}>{c.emoji}</span>
                    <span className="tx-main">
                      <span className="tx-title">
                        {tx.note || c.name}
                        {tx.recurringId && <span className="tag"><IconRepeat size={11} /> fix</span>}
                      </span>
                      <span className="tx-sub">{c.name} · {p?.emoji} {p?.name}</span>
                    </span>
                    <span className={`tx-amount ${tx.type}`}>
                      {tx.type === 'income' ? '+' : '−'}{formatEUR(tx.amountCents)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Buchung bearbeiten">
        {editing && <EntryForm key={editing.id} initial={editing} onDone={() => setEditing(null)} compact />}
      </Sheet>
    </div>
  )
}
