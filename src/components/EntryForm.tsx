import { useMemo, useState } from 'react'
import type { Transaction, TxType } from '../types'
import { store, useStore } from '../data/store'
import { categoriesFor, getCategory } from '../data/categories'
import { CategoryChips, Keypad, PersonPicker, Segmented } from './ui'
import { applyKey } from '../logic/keypad'
import { centsToInput, formatEUR, parseEURInput } from '../logic/money'
import { formatShortDate, monthOf, today } from '../logic/dates'
import { budgetStatus, spendByCategory, txOfMonth } from '../logic/stats'
import { showToast } from './toast'
import { IconCalendar, IconTrash } from './Icons'

interface Props {
  initial?: Transaction
  onDone?: () => void
  compact?: boolean
}

export function EntryForm({ initial, onDone, compact }: Props) {
  const { data } = useStore()
  const [type, setType] = useState<TxType>(initial?.type ?? 'expense')
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [personId, setPersonId] = useState(initial?.personId ?? data.settings.lastPersonId)
  const [note, setNote] = useState(initial?.note ?? '')
  const [date, setDate] = useState(initial?.date ?? today())
  const cats = useMemo(() => categoriesFor(type), [type])
  const cents = parseEURInput(amount)
  const canSave = cents > 0 && !!categoryId

  const switchType = (t: TxType) => {
    setType(t)
    if (getCategory(categoryId).type !== t) setCategoryId(t === 'income' ? 'gehalt' : '')
  }

  const save = () => {
    if (!canSave) return
    const payload = { type, amountCents: cents, categoryId, personId, note: note.trim() || undefined, date: date || today() }
    const cat = getCategory(categoryId)
    if (initial) {
      store.updateTransaction(initial.id, payload)
      showToast('Änderung gespeichert ✓')
    } else {
      const tx = store.addTransaction(payload)
      // Budget feedback right after saving
      const budget = store.getSnapshot().data.budgets[categoryId]
      let text = `${cat.emoji} ${formatEUR(cents)} ${type === 'income' ? 'Einnahme' : cat.name} gespeichert`
      let tone: 'ok' | 'warn' | 'over' = 'ok'
      if (type === 'expense' && budget?.limitCents) {
        const spent = spendByCategory(txOfMonth(store.getSnapshot().data, monthOf(payload.date))).get(categoryId) ?? 0
        const st = budgetStatus(spent, budget.limitCents)
        if (st.level === 'over') {
          tone = 'over'
          text = `⚠️ ${cat.name}: Budget um ${formatEUR(-st.remaining)} überschritten`
        } else if (st.level === 'warn') {
          tone = 'warn'
          text = `${cat.emoji} Gespeichert – noch ${formatEUR(st.remaining)} im ${cat.name}-Budget`
        }
      }
      showToast(text, { tone, action: { label: 'Rückgängig', run: () => store.deleteTransaction(tx.id) } })
      setAmount('')
      setNote('')
      setDate(today())
      if (type === 'expense') setCategoryId('')
    }
    onDone?.()
  }

  const remove = () => {
    if (!initial) return
    if (!window.confirm('Diese Buchung wirklich löschen?')) return
    store.deleteTransaction(initial.id)
    showToast('Buchung gelöscht', { action: { label: 'Rückgängig', run: () => store.restoreTransaction(initial.id) } })
    onDone?.()
  }

  const [int, dec] = (amount || '0').split(',')
  const intFmt = Number(int || '0').toLocaleString('de-DE')

  return (
    <div className={`entry ${compact ? 'compact' : ''} ${type}`}>
      <Segmented
        className="type-toggle"
        value={type}
        onChange={switchType}
        options={[
          { value: 'expense', label: 'Ausgabe' },
          { value: 'income', label: 'Einnahme' },
        ]}
      />
      <div className={`amount ${amount ? '' : 'placeholder'}`} aria-live="polite">
        <span className="amount-sign">{type === 'expense' ? '−' : '+'}</span>
        <span className="amount-int">{intFmt}</span>
        <span className="amount-dec">,{(dec ?? '').padEnd(2, amount.includes(',') ? '_' : '0').replace(/_/g, '0')}</span>
        <span className="amount-cur">€</span>
      </div>
      <CategoryChips categories={cats} value={categoryId} onChange={setCategoryId} />
      <div className="entry-meta">
        <PersonPicker persons={data.settings.persons} value={personId} onChange={setPersonId} small />
        <label className="date-pill">
          <IconCalendar size={16} />
          <span>{formatShortDate(date)}</span>
          <input type="date" value={date} max="2099-12-31" onChange={(e) => setDate(e.target.value || today())} aria-label="Datum" />
        </label>
      </div>
      <input className="note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz (optional)" maxLength={80} enterKeyHint="done" />
      <Keypad onKey={(k) => setAmount((v) => applyKey(v, k))} />
      <div className="entry-actions">
        {initial && (
          <button type="button" className="btn danger-ghost" onClick={remove} aria-label="Buchung löschen">
            <IconTrash size={20} />
          </button>
        )}
        <button type="button" className={`btn primary big ${type}`} disabled={!canSave} onClick={save}>
          {!cents ? 'Betrag eingeben' : !categoryId ? 'Kategorie wählen' : initial ? 'Änderung speichern' : `${formatEUR(cents)} speichern`}
        </button>
      </div>
    </div>
  )
}
