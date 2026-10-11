import { useState } from 'react'
import type { PersonId, SavingsGoal } from '../types'
import { goalSaved, store, useStore } from '../data/store'
import { BADGES } from '../logic/badges'
import { lastDays, streaks } from '../logic/streaks'
import { formatEUR, parseEURInput, centsToInput } from '../logic/money'
import { parseISODate } from '../logic/dates'
import { Empty, PersonPicker, Progress, Sheet } from '../components/ui'
import { RecapCard } from '../components/RecapCard'
import { showToast } from '../components/toast'
import { IconPlus, IconTrash } from '../components/Icons'
import { payers } from '../data/people'

const wd = new Intl.DateTimeFormat('de-DE', { weekday: 'narrow' })
const earnedFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })

export function AchievementsScreen() {
  const { data } = useStore()
  const s = streaks(data)
  const days = lastDays(data, 14)
  const hasJoint = days.some((d) => d.joint)
  const [p1, p2] = data.settings.persons
  const [goalEdit, setGoalEdit] = useState<SavingsGoal | 'new' | null>(null)
  const [deposit, setDeposit] = useState<SavingsGoal | null>(null)
  const goals = data.goals.filter((g) => !g.deleted)
  const earnedCount = BADGES.filter((b) => data.badges[b.id]).length

  const notLoggedToday = ([['p1', s.p1], ['p2', s.p2]] as const).filter(([, st]) => !st.loggedToday)

  return (
    <div className="screen">
      <header className="topbar">
        <h1>Erfolge</h1>
      </header>

      <section className="card streak-card">
        <div className="streak-hero">
          <div className={`flame ${s.shared.length > 0 ? 'on' : ''}`}>🔥</div>
          <div>
            <div className="streak-num">{s.shared.length} {s.shared.length === 1 ? 'Tag' : 'Tage'}</div>
            <div className="streak-sub">gemeinsame Serie · Rekord {s.shared.best}</div>
          </div>
        </div>
        <div className="streak-people">
          {[{ p: p1, st: s.p1 }, { p: p2, st: s.p2 }].map(({ p, st }) => (
            <div key={p.id} className="streak-person">
              <span>{p.emoji} {p.name}</span>
              <b>{st.length} 🔥</b>
              <small>{st.loggedToday ? 'heute ✓' : 'heute noch offen'}</small>
            </div>
          ))}
        </div>
        <div className="streak-cal" aria-label="Letzte 14 Tage">
          {days.map((d) => (
            <div key={d.date} className="cal-day">
              <span className={`cal-dot ${d.p1 ? 'on p1' : ''}`} />
              <span className={`cal-dot ${d.p2 ? 'on p2' : ''}`} />
              {hasJoint && <span className={`cal-dot ${d.joint ? 'on joint' : ''}`} />}
              <small>{wd.format(parseISODate(d.date))}</small>
            </div>
          ))}
        </div>
        <div className="cal-legend">
          <span><i className="cal-dot on p1" /> {p1.name}</span>
          <span><i className="cal-dot on p2" /> {p2.name}</span>
          {hasJoint && <span><i className="cal-dot on joint" /> {data.settings.joint.name}</span>}
        </div>
        {notLoggedToday.length > 0 && (
          <div className="checkin-row">
            {notLoggedToday.map(([id]) => {
              const p = data.settings.persons.find((x) => x.id === id)!
              return (
                <button
                  key={id}
                  type="button"
                  className="pill"
                  onClick={() => {
                    store.checkInNoSpend(id)
                    showToast(`🧘 ${p.name}: Tag ohne Ausgaben eingecheckt – Serie läuft weiter!`)
                  }}
                >
                  {p.emoji} Heute nichts ausgegeben
                </button>
              )
            })}
          </div>
        )}
      </section>

      <RecapCard />

      <div className="section-head">
        <h3 className="section-title">Gemeinsame Sparziele</h3>
        <button type="button" className="text-btn" onClick={() => setGoalEdit('new')}>
          <IconPlus size={16} /> Neu
        </button>
      </div>
      {goals.length === 0 && (
        <section className="card">
          <Empty emoji="🐷" title="Noch kein Sparziel" text="Urlaub, neues Sofa, Notgroschen? Legt euer erstes gemeinsames Ziel an." />
        </section>
      )}
      {goals.map((g) => {
        const saved = goalSaved(g)
        const ratio = g.targetCents ? saved / g.targetCents : 0
        const by = (id: PersonId) => g.contributions.filter((c) => c.personId === id).reduce((a, c) => a + c.amountCents, 0)
        return (
          <section key={g.id} className={`card goal-card ${g.reachedAt ? 'reached' : ''}`}>
            <button type="button" className="goal-top" onClick={() => setGoalEdit(g)}>
              <span className="goal-emoji">{g.emoji}</span>
              <span className="goal-text">
                <b>{g.name}</b>
                <small>{formatEUR(saved)} von {formatEUR(g.targetCents)}</small>
              </span>
              <span className="goal-pct">{Math.min(100, Math.round(ratio * 100))} %</span>
            </button>
            <Progress ratio={ratio} level="goal" />
            <div className="goal-bottom">
              <small className="muted">
                {payers(data.settings)
                  .filter((p) => p.id !== 'joint' || by('joint') > 0)
                  .map((p) => `${p.emoji}\u00a0${formatEUR(by(p.id))}`)
                  .join(' · ')}
              </small>
              {g.reachedAt ? (
                <span className="goal-done">🎯 Erreicht!</span>
              ) : (
                <button type="button" className="pill accent" onClick={() => setDeposit(g)}>+ Einzahlen</button>
              )}
            </div>
          </section>
        )
      })}

      <div className="section-head">
        <h3 className="section-title">Abzeichen</h3>
        <span className="muted small-text">{earnedCount} von {BADGES.length}</span>
      </div>
      <div className="badges">
        {BADGES.map((b) => {
          const at = data.badges[b.id]
          return (
            <div key={b.id} className={`badge ${at ? 'earned' : 'locked'}`} title={b.description}>
              <div className="badge-emoji">{at ? b.emoji : '🔒'}</div>
              <div className="badge-title">{b.title}</div>
              <div className="badge-desc">{at ? earnedFmt.format(new Date(at)) : b.description}</div>
            </div>
          )
        })}
      </div>

      <Sheet open={!!goalEdit} onClose={() => setGoalEdit(null)} title={goalEdit === 'new' ? 'Neues Sparziel' : 'Sparziel bearbeiten'}>
        {goalEdit && <GoalEditor key={goalEdit === 'new' ? 'new' : goalEdit.id} goal={goalEdit === 'new' ? undefined : goalEdit} onDone={() => setGoalEdit(null)} />}
      </Sheet>
      <Sheet open={!!deposit} onClose={() => setDeposit(null)} title={deposit ? `${deposit.emoji} ${deposit.name}` : ''}>
        {deposit && <DepositForm key={deposit.id} goal={deposit} onDone={() => setDeposit(null)} />}
      </Sheet>
    </div>
  )
}

const GOAL_EMOJIS = ['✈️', '🏖️', '🛋️', '🚗', '💍', '🏠', '🎄', '🛟', '🚲', '🐷']

function GoalEditor({ goal, onDone }: { goal?: SavingsGoal; onDone: () => void }) {
  const [name, setName] = useState(goal?.name ?? '')
  const [emoji, setEmoji] = useState(goal?.emoji ?? '✈️')
  const [target, setTarget] = useState(goal ? centsToInput(goal.targetCents) : '')
  const cents = parseEURInput(target)
  return (
    <div className="form">
      <label className="field">
        <span>Wofür spart ihr?</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Sommerurlaub" maxLength={40} />
      </label>
      <div className="emoji-pick">
        {GOAL_EMOJIS.map((e) => (
          <button key={e} type="button" className={e === emoji ? 'active' : ''} onClick={() => setEmoji(e)}>{e}</button>
        ))}
      </div>
      <label className="field">
        <span>Zielbetrag (€)</span>
        <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="z. B. 2000" />
      </label>
      <div className="entry-actions">
        {goal && (
          <button
            type="button"
            className="btn danger-ghost"
            aria-label="Löschen"
            onClick={() => {
              if (window.confirm('Sparziel löschen?')) {
                store.deleteGoal(goal.id)
                onDone()
              }
            }}
          >
            <IconTrash size={20} />
          </button>
        )}
        <button
          type="button"
          className="btn primary big"
          disabled={!name.trim() || !cents}
          onClick={() => {
            store.saveGoal({ id: goal?.id, name: name.trim(), emoji, targetCents: cents })
            showToast(goal ? 'Sparziel aktualisiert ✓' : `${emoji} Sparziel „${name.trim()}“ angelegt`)
            onDone()
          }}
        >
          Speichern
        </button>
      </div>
    </div>
  )
}

function DepositForm({ goal, onDone }: { goal: SavingsGoal; onDone: () => void }) {
  const { data } = useStore()
  const [amount, setAmount] = useState('')
  const [person, setPerson] = useState<PersonId>(data.settings.lastPersonId)
  const missing = Math.max(0, goal.targetCents - goalSaved(goal))
  const cents = parseEURInput(amount)
  return (
    <div className="form">
      <p className="muted">Noch {formatEUR(missing)} bis zum Ziel.</p>
      <div className="quick-amounts">
        {[10, 25, 50, 100].map((n) => (
          <button key={n} type="button" className="pill" onClick={() => setAmount(String(n))}>{n} €</button>
        ))}
        {missing > 0 && <button type="button" className="pill" onClick={() => setAmount(centsToInput(missing))}>Rest</button>}
      </div>
      <label className="field">
        <span>Betrag (€)</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="0,00" />
      </label>
      <div className="field">
        <span>Wer zahlt ein?</span>
        <PersonPicker persons={payers(data.settings)} value={person} onChange={setPerson} />
      </div>
      <button
        type="button"
        className="btn primary big"
        disabled={!cents}
        onClick={() => {
          store.contribute(goal.id, person, cents)
          showToast(`🐷 ${formatEUR(cents)} für „${goal.name}“ gespart`)
          onDone()
        }}
      >
        Einzahlen
      </button>
    </div>
  )
}
