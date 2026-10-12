import { useState } from 'react'
import { germanAuthError, sync, useSync } from './engine'
import { InviteCode } from './AuthFlow'
import { useStore } from '../data/store'

const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })

export function SyncSettings({ onOpenAuth }: { onOpenAuth: () => void }) {
  const s = useSync()
  const { data } = useStore()
  if (s.phase === 'disabled') return null
  const me = s.household ? data.settings.persons[s.household.slot === 'p1' ? 0 : 1] : null
  return (
    <>
      <h3 className="section-title">Gemeinsam synchronisieren</h3>
      <section className="card form sync-card">
        {s.phase === 'loading' && <p className="muted">Lade …</p>}
        {s.phase === 'signed-out' && (
          <>
            <p className="muted small-text">Meldet euch beide an und verbindet eure iPhones zu einem Haushalt – dann seht ihr alle Einträge auf beiden Geräten.</p>
            <button type="button" className="btn primary full" onClick={onOpenAuth}>{s.pending ? 'Anmeldung fortsetzen' : 'Anmelden mit E-Mail'}</button>
          </>
        )}
        {(s.phase === 'no-household' || s.phase === 'needs-link') && (
          <>
            <p className="muted small-text">Angemeldet als <b>{s.email}</b>, aber noch nicht mit einem Haushalt verbunden.</p>
            <button type="button" className="btn primary full" onClick={onOpenAuth}>Haushalt erstellen / beitreten</button>
          </>
        )}
        {s.phase === 'ready' && s.household && (
          <>
            <div className="sync-row">
              <span>Status</span>
              <b className={`sync-text ${s.net}`}>
                {s.net === 'idle' ? '✓ Synchronisiert' : s.net === 'syncing' ? 'Synchronisiere …' : s.net === 'offline' ? 'Offline – wird nachgeholt' : '⚠️ Fehler'}
              </b>
            </div>
            {s.lastSyncAt && (
              <div className="sync-row"><span>Zuletzt</span><span>{timeFmt.format(new Date(s.lastSyncAt))} Uhr</span></div>
            )}
            <div className="sync-row"><span>Angemeldet als</span><span className="ellipsis">{s.email}</span></div>
            {me && <div className="sync-row"><span>Du bist</span><span>{me.emoji} {me.name}</span></div>}
            <div className="sync-row"><span>Mitglieder</span><span>{s.household.memberCount || '–'} von 2</span></div>
            {s.household.memberCount < 2 && (
              <>
                <p className="muted small-text">Einladungscode für deinen Partner / deine Partnerin:</p>
                <InviteCode code={s.household.inviteCode} />
              </>
            )}
            <button type="button" className="btn secondary full" onClick={() => sync.syncNow()}>🔄 Jetzt synchronisieren</button>
            <SwitchHousehold memberCount={s.household.memberCount} />
            <button
              type="button"
              className="btn danger full"
              onClick={() => {
                if (window.confirm('Abmelden? Die Daten bleiben auf diesem iPhone, werden aber nicht mehr abgeglichen.')) sync.signOut()
              }}
            >
              Abmelden
            </button>
          </>
        )}
      </section>
    </>
  )
}

function SwitchHousehold({ memberCount }: { memberCount: number }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (memberCount >= 2) return null
  if (!open)
    return (
      <button type="button" className="btn secondary full" onClick={() => setOpen(true)}>
        🔀 Anderem Haushalt beitreten
      </button>
    )
  const go = async () => {
    if (!window.confirm('Diesem Haushalt beitreten?\n\nDein bisheriger Haushalt (nur du als Mitglied) wird aufgelöst. Deine Einträge auf diesem iPhone bleiben erhalten – im nächsten Schritt kannst du sie in den neuen Haushalt übernehmen.')) return
    setBusy(true)
    setErr('')
    try {
      await sync.switchHousehold(code)
    } catch (e) {
      setErr(germanAuthError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="switch-household">
      <p className="muted small-text">Dein Partner / deine Partnerin hat schon einen eigenen Haushalt? Gib den Code ein, dann nutzt ihr beide denselben.</p>
      <input className="code-input" value={code} autoCapitalize="characters" autoCorrect="off" maxLength={9} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="z. B. K7M2QX" aria-label="Code des anderen Haushalts" />
      {err && <div className="auth-error">{err}</div>}
      <div className="field-row">
        <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Abbrechen</button>
        <button type="button" className="btn primary" style={{ flex: 1 }} disabled={code.replace(/[^A-Z0-9]/g, '').length < 6 || busy} onClick={go}>
          {busy ? 'Wechsle …' : 'Beitreten'}
        </button>
      </div>
    </div>
  )
}
