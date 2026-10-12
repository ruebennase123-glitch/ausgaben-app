import { SyncBadge } from '../sync/SyncBadge'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PersonId, Transaction } from '../types'
import { useStore } from '../data/store'
import { CATEGORIES, getCategory } from '../data/categories'
import { currentMonth, formatDayHeading } from '../logic/dates'
import { formatEUR, formatEURShort } from '../logic/money'
import { budgetStatus, live, spendByCategory, totals, txOfMonth } from '../logic/stats'
import { Donut, Empty, MonthSwitcher, Segmented, Sheet } from '../components/ui'
import { EntryForm } from '../components/EntryForm'
import { IconRepeat, IconSearch } from '../components/Icons'
import { CategoryDetail } from '../components/CategoryDetail'
import { RecapCard } from '../components/RecapCard'
import { payers } from '../data/people'

export function OverviewScreen() {
  const { data } = useStore()
  const [month, setMonth] = useState(currentMonth())
  const [person, setPerson] = useState<'all' | PersonId>('all')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const txs = useMemo(() => txOfMonth(data, month, person === 'all' ? undefined : person), [data, month, person])
  const t = totals(txs)
  const byCat = [...spendByCategory(txs).entries()].sort((a, b) => b[1] - a[1])
  const persons = payers(data.settings)
  const [legendAll, setLegendAll] = useState(false)

  // ----- category detail page, integrated with browser history (iPhone swipe-back / back button)
  const [detail, setDetail] = useState<string | null>(null)
  const openDetail = useCallback((id: string) => {
    history.pushState({ ...(history.state ?? {}), catDetail: id }, '')
    setDetail(id)
  }, [])
  const closeDetail = useCallback(() => {
    if (history.state?.catDetail) history.back()
    else setDetail(null)
  }, [])
  useEffect(() => {
    const onPop = () => setDetail(history.state?.catDetail ?? null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (!detail) return
    window.scrollTo(0, 0)
    document.body.classList.add('detail-open')
    return () => document.body.classList.remove('detail-open')
  }, [detail])

  // ----- search & filter
  const [query, setQuery] = useState('')
  const [cats, setCats] = useState<string[]>([])
  const [allMonths, setAllMonths] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const searching = query.trim().length > 0 || cats.length > 0 || allMonths
  const listTxs = useMemo(() => {
    const base = allMonths
      ? live(data)
          .filter((t) => person === 'all' || t.personId === person)
          .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
      : txs
    const q = query.trim().toLowerCase()
    const qAmount = q.replace(/\s|€/g, '').replace(/\./g, ',')
    return base.filter((t) => {
      if (cats.length && !cats.includes(t.categoryId)) return false
      if (!q) return true
      const c = getCategory(t.categoryId)
      if ((t.note ?? '').toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) return true
      if (!/\d/.test(qAmount)) return false
      const plain = (t.amountCents / 100).toFixed(2).replace('.', ',')
      return plain.includes(qAmount) || formatEUR(t.amountCents).replace(/\s|€/g, '').includes(qAmount)
    })
  }, [allMonths, data, person, txs, query, cats])
  const listTotals = totals(listTxs)

  const warnings = Object.values(data.budgets)
    .filter((b) => b.limitCents > 0)
    .map((b) => ({ b, st: budgetStatus(spendByCategory(txOfMonth(data, month)).get(b.categoryId) ?? 0, b.limitCents) }))
    .filter((x) => x.st.level !== 'ok')

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const tx of listTxs) m.set(tx.date, [...(m.get(tx.date) ?? []), tx])
    return [...m.entries()]
  }, [listTxs])

  return (
    <div className="screen">
      <header className="topbar">
        <h1>Übersicht</h1>
        <SyncBadge />
      </header>
      <MonthSwitcher month={month} onChange={setMonth} max={currentMonth()} />
      <Segmented
        className="small stacked person-filter"
        value={person}
        onChange={setPerson}
        options={[
          { value: 'all', label: <><span className="seg-emoji">👥</span><span className="seg-label">Beide</span></> },
          ...persons.map((p) => ({ value: p.id, label: <><span className="seg-emoji">{p.emoji}</span><span className="seg-label">{p.name}</span></> })),
        ]}
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
              onSelect={openDetail}
              size={128}
              thickness={18}
              data={byCat.map(([id, v]) => ({ key: id, value: v, color: getCategory(id).color, label: getCategory(id).name }))}
              center={
                <>
                  <small>Ausgaben</small>
                  <b>{formatEURShort(t.expense)}</b>
                </>
              }
            />
            <ul className="legend">
              {(legendAll ? byCat : byCat.slice(0, 6)).map(([id, v]) => {
                const c = getCategory(id)
                return (
                  <li key={id}>
                    <button type="button" className="legend-btn" onClick={() => openDetail(id)} aria-label={`${c.name}: ${formatEUR(v)} – Details`}>
                      <span className="dot" style={{ background: c.color }} />
                      <span className="legend-name">{c.emoji} {c.name}</span>
                      <span className="legend-val">{formatEURShort(v)}</span>
                    </button>
                  </li>
                )
              })}
              {byCat.length > 6 && (
                <li>
                  <button type="button" className="legend-btn legend-more" onClick={() => setLegendAll((v) => !v)} aria-expanded={legendAll}>
                    <span className="dot" style={{ background: 'var(--track)' }} />
                    <span className="legend-name">{legendAll ? 'Weniger anzeigen' : `+${byCat.length - 6} weitere`}</span>
                    {!legendAll && <span className="legend-val">{formatEURShort(byCat.slice(6).reduce((s, [, v]) => s + v, 0))}</span>}
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </section>

      {month === currentMonth() && <RecapCard compact />}

      <section className="tx-list">
        <h3 className="section-title">Buchungen</h3>
        <div className="search-row">
          <label className="search-field">
            <IconSearch size={17} />
            <input type="search" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen: Notiz, Kategorie, Betrag" aria-label="Buchungen durchsuchen" />
          </label>
          <button type="button" className={`filter-btn ${filterOpen || cats.length ? 'active' : ''}`} onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen}>
            Filter{cats.length ? ` (${cats.length})` : ''}
          </button>
        </div>
        {filterOpen && (
          <div className="filter-panel">
            <div className="filter-chips" role="group" aria-label="Kategorien filtern">
              {CATEGORIES.map((c) => {
                const on = cats.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`fchip ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    data-cat={c.id}
                    style={{ ['--c' as string]: c.color }}
                    onClick={() => setCats((cs) => (on ? cs.filter((x) => x !== c.id) : [...cs, c.id]))}
                  >
                    {c.emoji} {c.type === 'income' && c.id !== 'gehalt' ? 'Sonstige Einnahmen' : c.name}
                  </button>
                )
              })}
            </div>
            <label className="switch-row filter-switch">
              <span>In allen Monaten suchen</span>
              <input type="checkbox" className="switch" checked={allMonths} onChange={(e) => setAllMonths(e.target.checked)} aria-label="In allen Monaten suchen" />
            </label>
            {(cats.length > 0 || allMonths) && (
              <button type="button" className="text-btn" onClick={() => { setCats([]); setAllMonths(false) }}>Filter zurücksetzen</button>
            )}
          </div>
        )}
        {searching && (
          <div className="search-summary" role="status">
            <b>{listTxs.length} {listTxs.length === 1 ? 'Treffer' : 'Treffer'}</b>
            {allMonths ? ' · alle Monate' : ''}
            {listTotals.expense > 0 && <> · Ausgaben <b className="neg">−{formatEUR(listTotals.expense)}</b></>}
            {listTotals.income > 0 && <> · Einnahmen <b className="pos">+{formatEUR(listTotals.income)}</b></>}
          </div>
        )}
        {groups.length === 0 && <Empty emoji={searching ? '🔍' : '🧾'} title={searching ? 'Nichts gefunden' : 'Keine Buchungen in diesem Monat'} />}
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

      {detail && <CategoryDetail categoryId={detail} month={month} person={person} onBack={closeDetail} onEdit={setEditing} />}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Buchung bearbeiten">
        {editing && <EntryForm key={editing.id} initial={editing} onDone={() => setEditing(null)} compact />}
      </Sheet>
    </div>
  )
}
