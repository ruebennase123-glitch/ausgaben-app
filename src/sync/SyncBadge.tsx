import { useSync } from './engine'

/** Small cloud status icon for the top bar (hidden when not signed in to a household). */
export function SyncBadge() {
  const s = useSync()
  if (s.phase !== 'ready') return null
  const map = {
    idle: { cls: 'ok', label: 'Synchronisiert', icon: '✓' },
    syncing: { cls: 'busy', label: 'Synchronisiere …', icon: '' },
    offline: { cls: 'off', label: 'Offline – wird später abgeglichen', icon: '⨯' },
    error: { cls: 'err', label: 'Sync-Fehler', icon: '!' },
  } as const
  const m = map[s.net]
  return (
    <span className={`sync-badge ${m.cls}`} title={m.label} aria-label={m.label} role="status">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z" fill="currentColor" opacity="0.18" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <span className="sync-icon">{m.icon}</span>
    </span>
  )
}
