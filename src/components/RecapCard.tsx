import { useStore } from '../data/store'
import { getCategory } from '../data/categories'
import { weeklyRecap } from '../logic/stats'
import { payers } from '../data/people'
import { formatEUR } from '../logic/money'
import { parseISODate } from '../logic/dates'

const short = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' })

export function RecapCard({ compact }: { compact?: boolean }) {
  const { data } = useStore()
  const r = weeklyRecap(data)
  const people = payers(data.settings)
  const top = r.topCategory ? getCategory(r.topCategory[0]) : null
  let trend = 'Erste Woche – weiter so!'
  let tone = 'neutral'
  if (r.change !== null) {
    const pct = Math.round(Math.abs(r.change) * 100)
    if (r.change <= -0.05) {
      trend = `${pct} % weniger als in der Vorwoche 🎉`
      tone = 'good'
    } else if (r.change >= 0.05) {
      trend = `${pct} % mehr als in der Vorwoche`
      tone = 'bad'
    } else trend = 'Ungefähr wie in der Vorwoche'
  }
  return (
    <section className="card recap-card">
      <div className="recap-head">
        <span className="recap-kicker">Wochenrückblick</span>
        <span className="recap-range">{short.format(parseISODate(r.from))} – {short.format(parseISODate(r.to))}</span>
      </div>
      <div className="recap-main">
        <div>
          <div className="recap-value">{formatEUR(r.spent)}</div>
          <div className="recap-label">ausgegeben (ohne Fixkosten)</div>
        </div>
        <div className="recap-days">
          <b>{r.loggedDays}/7</b>
          <span>Tage erfasst</span>
        </div>
      </div>
      <div className={`recap-trend ${tone}`}>{trend}</div>
      {!compact && (
        <ul className="recap-facts">
          {top && <li>Größter Posten: <b>{top.emoji} {top.name}</b> ({formatEUR(r.topCategory![1])})</li>}
          {people
            .filter((p) => p.id !== 'joint' || r.perPerson.joint > 0)
            .map((p) => (
              <li key={p.id} className="recap-person">
                <span>{p.emoji} {p.name}</span>
                <span>
                  <b>{formatEUR(r.spentPerPerson[p.id])}</b> · {r.perPerson[p.id]} {r.perPerson[p.id] === 1 ? 'Eintrag' : 'Einträge'}
                </span>
              </li>
            ))}
          {r.saved > 0 && <li>Aufs Sparziel gelegt: <b>{formatEUR(r.saved)}</b> 🐷</li>}
        </ul>
      )}
    </section>
  )
}
