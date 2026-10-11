import { useState } from 'react'
import type { RecurringRule, TxType, PersonId } from '../types'
import { store, useStore } from '../data/store'
import { categoriesFor, getCategory } from '../data/categories'
import { currentMonth, daysInMonth, today } from '../logic/dates'
import { centsToInput, formatEUR, parseEURInput } from '../logic/money'
import { budgetStatus, spendByCategory, txOfMonth } from '../logic/stats'
import { CategoryChips, Empty, Keypad, MonthSwitcher, PersonPicker, Progress, Segmented, Sheet } from '../components/ui'
import { applyKey } from '../logic/keypad'
import { showToast } from '../components/toast'
import { IconPlus, IconTrash } from '../components/Icons'
import { payers } from '../data/people'

export function PlanScreen() {
  const [tab, setTab] = useState<'budgets' | 'fix'>('budgets')
  return (
    <div className="screen">
      <header className="topbar">
        <h1>Planen</h1>
      </header>
      <Segmented
        className="plan-tabs"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'budgets', label: '🎯 Budgets' },
          { value: 'fix', label: '🔁 Fixkosten' },
        ]}
      />
      {tab === 'budgets' ? <Budgets /> : <Recurring />}
    </div>
  )
}

function Budgets() {
  const { data } = useStore()
  const [month, setMonth] = useState(currentMonth())
  const [edit, setEdit] = useState<string | null>(null)
  const spent = spendByCategory(txOfMonth(data, month))
  const cats = categoriesFor('expense')
  const withBudget = cats.filter((c) => (data.budgets[c.id]?.limitCents ?? 0) > 0)
  const without = cats.filter((c) => !((data.budgets[c.id]?.limitCents ?? 0) > 0))
  const totalLimit = withBudget.reduce((s, c) => s + data.budgets[c.id].limitCents, 0)
  const totalSpent = withBudget.reduce((s, c) => s + (spent.get(c.id) ?? 0), 0)
  const total = budgetStatus(totalSpent, totalLimit)
  const isCurrent = month === currentMonth()
  const dayRatio = isCurrent ? Number(today().slice(8)) / daysInMonth(month) : 1

  return (
    <>
      <MonthSwitcher month={month} onChange={setMonth} max={currentMonth()} />
      {withBudget.length === 0 ? (
        <section className="card">
          <Empty emoji="🧭" title="Noch keine Budgets" text="Legt für einzelne Kategorien ein Monatsbudget fest – wir warnen euch rechtzeitig." />
        </section>
      ) : (
        <section className={`card budget-total ${total.level}`}>
          <div className="budget-total-top">
            <div>
              <div className="muted small-text">Gesamtbudget</div>
              <div className="budget-total-value">
                {formatEUR(totalSpent)} <span className="muted">von {formatEUR(totalLimit)}</span>
              </div>
            </div>
            <div className={`budget-badge ${total.level}`}>
              {total.remaining >= 0 ? `${formatEUR(total.remaining)} übrig` : `${formatEUR(-total.remaining)} drüber`}
            </div>
          </div>
          <div className="pace-wrap">
            <Progress ratio={total.ratio} level={total.level} />
            {isCurrent && <div className="pace-marker" style={{ left: `${dayRatio * 100}%` }} title="Heute" />}
          </div>
          {isCurrent && (
            <div className="muted small-text">
              {total.ratio <= dayRatio ? '👍 Ihr liegt im Plan für diesen Monat.' : '👀 Ihr gebt gerade etwas schneller aus als geplant.'}
            </div>
          )}
        </section>
      )}

      <div className="budget-list">
        {withBudget.map((c) => {
          const s = spent.get(c.id) ?? 0
          const lim = data.budgets[c.id].limitCents
          const st = budgetStatus(s, lim)
          return (
            <button key={c.id} type="button" className={`card budget-row ${st.level}`} onClick={() => setEdit(c.id)}>
              <div className="budget-row-top">
                <span className="budget-name">
                  <span className="tx-icon sm" style={{ background: `color-mix(in srgb, ${c.color} 18%, transparent)` }}>{c.emoji}</span>
                  {c.name}
                </span>
                <span className="budget-amounts">
                  <b>{formatEUR(s)}</b> / {formatEUR(lim)}
                </span>
              </div>
              <Progress ratio={st.ratio} level={st.level} color={st.level === 'ok' ? c.color : undefined} />
              <div className={`budget-hint ${st.level}`}>
                {st.level === 'over'
                  ? `⚠️ ${formatEUR(-st.remaining)} über Budget`
                  : st.level === 'warn'
                    ? `⏳ Achtung: nur noch ${formatEUR(st.remaining)} übrig`
                    : `Noch ${formatEUR(st.remaining)} übrig`}
              </div>
            </button>
          )
        })}
      </div>

      {without.length > 0 && (
        <>
          <h3 className="section-title">Ohne Budget</h3>
          <div className="card nobudget">
            {without.map((c) => (
              <button key={c.id} type="button" className="nobudget-row" onClick={() => setEdit(c.id)}>
                <span>{c.emoji} {c.name}</span>
                <span className="muted">{spent.get(c.id) ? formatEUR(spent.get(c.id)!) : ''}</span>
                <span className="add-link"><IconPlus size={16} /> Budget</span>
              </button>
            ))}
          </div>
        </>
      )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Monatsbudget">
        {edit && <BudgetEditor key={edit} categoryId={edit} onDone={() => setEdit(null)} />}
      </Sheet>
    </>
  )
}

function BudgetEditor({ categoryId, onDone }: { categoryId: string; onDone: () => void }) {
  const { data } = useStore()
  const c = getCategory(categoryId)
  const current = data.budgets[categoryId]?.limitCents ?? 0
  const [v, setV] = useState(current ? centsToInput(current) : '')
  const save = (cents: number) => {
    store.setBudget(categoryId, cents)
    showToast(cents ? `${c.emoji} Budget für ${c.name}: ${formatEUR(cents)}` : `Budget für ${c.name} entfernt`)
    onDone()
  }
  return (
    <div className="budget-editor">
      <div className="be-cat">{c.emoji} {c.name}</div>
      <div className="amount small">
        <span className="amount-int">{v || '0'}</span>
        <span className="amount-cur">€ / Monat</span>
      </div>
      <div className="quick-amounts">
        {[50, 100, 200, 300, 500].map((n) => (
          <button key={n} type="button" className="pill" onClick={() => setV(String(n))}>{n} €</button>
        ))}
      </div>
      <Keypad onKey={(k) => setV((x) => applyKey(x, k))} />
      <div className="entry-actions">
        {current > 0 && (
          <button type="button" className="btn danger-ghost" onClick={() => save(0)} aria-label="Budget entfernen">
            <IconTrash size={20} />
          </button>
        )}
        <button type="button" className="btn primary big" disabled={!parseEURInput(v)} onClick={() => save(parseEURInput(v))}>
          Budget speichern
        </button>
      </div>
    </div>
  )
}

function Recurring() {
  const { data } = useStore()
  const [edit, setEdit] = useState<RecurringRule | 'new' | null>(null)
  const rules = data.recurring.filter((r) => !r.deleted).sort((a, b) => a.dayOfMonth - b.dayOfMonth)
  const sum = (t: TxType) => rules.filter((r) => r.active && r.type === t).reduce((s, r) => s + r.amountCents, 0)
  const persons = payers(data.settings)
  return (
    <>
      <section className="card fix-summary">
        <div>
          <small>Fixe Einnahmen</small>
          <b className="pos">+{formatEUR(sum('income'))}</b>
        </div>
        <div>
          <small>Fixkosten</small>
          <b className="neg">−{formatEUR(sum('expense'))}</b>
        </div>
        <div>
          <small>Frei verfügbar</small>
          <b>{formatEUR(sum('income') - sum('expense'))}</b>
        </div>
      </section>
      <p className="hint">Wird jeden Monat am gewählten Tag automatisch als Buchung angelegt.</p>
      {rules.length === 0 ? (
        <section className="card">
          <Empty emoji="🔁" title="Noch keine Fixkosten" text="z. B. Miete, Strom, Handy, Streaming oder das Gehalt." />
        </section>
      ) : (
        <div className="card tx-card">
          {rules.map((r) => {
            const c = getCategory(r.categoryId)
            const p = persons.find((x) => x.id === r.personId)
            return (
              <button key={r.id} type="button" className={`tx-row ${r.active ? '' : 'inactive'}`} onClick={() => setEdit(r)}>
                <span className="tx-icon" style={{ background: `color-mix(in srgb, ${c.color} 18%, transparent)` }}>{c.emoji}</span>
                <span className="tx-main">
                  <span className="tx-title">{r.note || c.name}{!r.active && <span className="tag">pausiert</span>}</span>
                  <span className="tx-sub">jeden {r.dayOfMonth}. · {p?.emoji} {p?.name}</span>
                </span>
                <span className={`tx-amount ${r.type}`}>{r.type === 'income' ? '+' : '−'}{formatEUR(r.amountCents)}</span>
              </button>
            )
          })}
        </div>
      )}
      <button type="button" className="btn secondary full" onClick={() => setEdit('new')}>
        <IconPlus size={18} /> Fixkosten / Einnahme hinzufügen
      </button>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Neue Fixbuchung' : 'Fixbuchung bearbeiten'}>
        {edit && <RecurringEditor key={edit === 'new' ? 'new' : edit.id} rule={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Sheet>
    </>
  )
}

function RecurringEditor({ rule, onDone }: { rule?: RecurringRule; onDone: () => void }) {
  const { data } = useStore()
  const [type, setType] = useState<TxType>(rule?.type ?? 'expense')
  const [amount, setAmount] = useState(rule ? centsToInput(rule.amountCents) : '')
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? 'wohnen')
  const [personId, setPersonId] = useState<PersonId>(rule?.personId ?? data.settings.lastPersonId)
  const [note, setNote] = useState(rule?.note ?? '')
  const [day, setDay] = useState(rule?.dayOfMonth ?? 1)
  const [active, setActive] = useState(rule?.active ?? true)
  const cents = parseEURInput(amount)
  const valid = cents > 0 && note.trim().length > 0
  const save = () => {
    store.saveRecurring({ id: rule?.id, type, amountCents: cents, categoryId, personId, note: note.trim(), dayOfMonth: day, startMonth: rule?.startMonth ?? currentMonth(), active })
    showToast(rule ? 'Fixbuchung aktualisiert ✓' : '🔁 Fixbuchung angelegt – fällige Monate werden automatisch gebucht')
    onDone()
  }
  const remove = () => {
    if (!rule || !window.confirm('Fixbuchung löschen? Bereits erzeugte Buchungen bleiben erhalten.')) return
    store.deleteRecurring(rule.id)
    onDone()
  }
  return (
    <div className="form">
      <Segmented
        value={type}
        onChange={(t) => {
          setType(t)
          setCategoryId(t === 'income' ? 'gehalt' : 'wohnen')
        }}
        options={[
          { value: 'expense', label: 'Fixkosten' },
          { value: 'income', label: 'Einnahme' },
        ]}
      />
      <label className="field">
        <span>Bezeichnung</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'income' ? 'z. B. Gehalt' : 'z. B. Miete'} maxLength={40} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Betrag (€)</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="0,00" />
        </label>
        <label className="field narrow">
          <span>Am Tag</span>
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}.</option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <span>Kategorie</span>
        <CategoryChips categories={categoriesFor(type)} value={categoryId} onChange={setCategoryId} />
      </div>
      <div className="field">
        <span>Wer zahlt / bekommt es?</span>
        <PersonPicker persons={payers(data.settings)} value={personId} onChange={setPersonId} />
      </div>
      {rule && (
        <label className="switch-row">
          <span>Aktiv</span>
          <input type="checkbox" className="switch" checked={active} onChange={(e) => setActive(e.target.checked)} />
        </label>
      )}
      <div className="entry-actions">
        {rule && (
          <button type="button" className="btn danger-ghost" onClick={remove} aria-label="Löschen">
            <IconTrash size={20} />
          </button>
        )}
        <button type="button" className="btn primary big" disabled={!valid} onClick={save}>
          Speichern
        </button>
      </div>
    </div>
  )
}
