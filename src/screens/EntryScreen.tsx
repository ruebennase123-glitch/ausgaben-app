import { EntryForm } from '../components/EntryForm'
import { useStore } from '../data/store'
import { streaks } from '../logic/streaks'

export function EntryScreen() {
  const { data } = useStore()
  const s = streaks(data)
  return (
    <div className="screen entry-screen">
      <header className="topbar">
        <h1>Neue Buchung</h1>
        <div className={`streak-pill ${s.shared.loggedToday ? 'lit' : ''}`} title="Gemeinsame Serie">
          🔥 <b>{s.shared.length}</b> {s.shared.length === 1 ? 'Tag' : 'Tage'}
        </div>
      </header>
      <EntryForm />
    </div>
  )
}
