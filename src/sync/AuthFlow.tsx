import { useEffect, useRef, useState } from 'react'
import { germanAuthError, sync, useSync } from './engine'
import { useStore } from '../data/store'

interface Props {
  onClose: () => void
  onboarding?: boolean
}

export function AuthFlow({ onClose, onboarding }: Props) {
  const s = useSync()
  const [intro, setIntro] = useState(!!onboarding)
  let body
  if (s.phase === 'loading') body = <Spinner text="Einen Moment …" />
  else if (s.phase === 'signed-out') body = s.pending ? <WaitStep /> : intro ? <Intro onStart={() => setIntro(false)} onSkip={onClose} /> : <EmailStep />
  else if (s.phase === 'no-household') body = <HouseholdStep />
  else if (s.phase === 'needs-link') body = <LinkStep />
  else if (s.phase === 'ready') body = <DoneStep onClose={onClose} />
  else body = null
  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Anmelden und synchronisieren">
      <div className="auth-inner">
        <div className="auth-top">
          <span className="auth-logo">💶</span>
          {!(intro && s.phase === 'signed-out' && !s.pending) && (
            <button type="button" className="text-btn" onClick={onClose}>
              {s.phase === 'ready' ? 'Fertig' : 'Später'}
            </button>
          )}
        </div>
        {s.error && s.phase !== 'ready' && <div className="auth-error">{s.error}</div>}
        {body}
      </div>
    </div>
  )
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="auth-wait">
      <span className="spinner" aria-hidden />
      <span>{text}</span>
    </div>
  )
}

function Intro({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="auth-step">
      <h1>Willkommen im Haushaltsbuch 👋</h1>
      <p className="auth-lead">Erfasst eure Ausgaben gemeinsam – auf beiden iPhones, immer synchron. Funktioniert auch offline.</p>
      <ul className="auth-points">
        <li>⚡ Ausgabe in 5 Sekunden eintragen</li>
        <li>🤝 Gemeinsamer Haushalt mit Einladungscode</li>
        <li>🔒 Nur ihr zwei seht eure Daten</li>
      </ul>
      <button type="button" className="btn primary big full" onClick={onStart}>Anmelden mit E-Mail</button>
      <button type="button" className="btn secondary full" onClick={onSkip}>Erst mal ohne Konto (nur dieses Gerät)</button>
    </div>
  )
}

function EmailStep() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  return (
    <form
      className="auth-step"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        setBusy(true)
        setErr('')
        try {
          await sync.requestLogin(email.trim().toLowerCase())
        } catch (er) {
          setErr(germanAuthError(er))
        } finally {
          setBusy(false)
        }
      }}
    >
      <h1>Anmelden mit E-Mail</h1>
      <p className="auth-lead">Kein Passwort nötig: Wir schicken dir einen Anmeldelink per E-Mail.</p>
      <label className="field">
        <span>Deine E-Mail-Adresse</span>
        <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@beispiel.de" required />
      </label>
      {err && <div className="auth-error">{err}</div>}
      <button type="submit" className="btn primary big full" disabled={!valid || busy}>{busy ? 'Wird gesendet …' : 'Anmeldelink senden'}</button>
    </form>
  )
}

function WaitStep() {
  const s = useSync()
  const [code, setCode] = useState('')
  const [showCode, setShowCode] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="auth-step">
      <h1>📬 Schau in dein Postfach</h1>
      <p className="auth-lead">Wir haben eine E-Mail an <b>{s.pending?.email}</b> geschickt (Absender „Supabase Auth“, Betreff „Your sign-in link“ oder „Confirm your email address“).</p>
      <ol className="auth-steps-list">
        <li>E-Mail auf <b>diesem iPhone</b> öffnen und auf den Link tippen.</li>
        <li>Safari zeigt „Angemeldet ✓“.</li>
        <li>Zurück zur Haushaltsbuch-App wechseln – du wirst automatisch angemeldet.</li>
      </ol>
      <Spinner text="Warte auf die Bestätigung …" />
      <button type="button" className="text-btn" onClick={() => setShowCode((v) => !v)}>Ich habe einen Zahlencode bekommen</button>
      {showCode && (
        <form
          className="code-row"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setErr('')
            try {
              await sync.verifyCode(s.pending!.email, code)
            } catch (er) {
              setErr(germanAuthError(er))
            } finally {
              setBusy(false)
            }
          }}
        >
          <input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" aria-label="Code" />
          <button type="submit" className="btn primary" disabled={code.length < 6 || busy}>Bestätigen</button>
        </form>
      )}
      {err && <div className="auth-error">{err}</div>}
      <button type="button" className="btn secondary full" onClick={() => sync.cancelLogin()}>Andere E-Mail-Adresse / neu senden</button>
    </div>
  )
}

function HouseholdStep() {
  const s = useSync()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'' | 'create' | 'join'>('')
  const [err, setErr] = useState('')
  const run = async (kind: 'create' | 'join') => {
    setBusy(kind)
    setErr('')
    try {
      if (kind === 'create') await sync.createHousehold()
      else await sync.joinHousehold(code)
    } catch (e) {
      setErr(germanAuthError(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="auth-step">
      <h1>Euer gemeinsamer Haushalt</h1>
      <p className="auth-lead">Angemeldet als <b>{s.email}</b>. Ihr teilt <b>einen</b> Haushalt: Eine Person erstellt ihn, die andere tritt mit dem Code bei.</p>
      {s.householdGone && <div className="auth-info">Dein bisheriger Haushalt ist nicht mehr verbunden. Tritt jetzt dem Haushalt deines Partners / deiner Partnerin bei.</div>}
      <section className="auth-choice">
        <h2>🤝 Dein Partner / deine Partnerin nutzt die App schon?</h2>
        <p className="muted small-text">Lass dir den Einladungscode geben (in der App unter „Mehr → Gemeinsam synchronisieren“).</p>
        <input className="code-input" value={code} autoCapitalize="characters" autoCorrect="off" maxLength={9} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="z. B. K7M2QX" aria-label="Einladungscode" />
        <button type="button" className="btn primary big full" disabled={code.replace(/[^A-Z0-9]/g, '').length < 6 || !!busy} onClick={() => run('join')}>
          {busy === 'join' ? 'Trete bei …' : 'Mit Code beitreten'}
        </button>
      </section>
      {err && <div className="auth-error">{err}</div>}
      <div className="auth-divider"><span>oder</span></div>
      <section className="auth-choice">
        <h2>🏠 Ihr fangt gerade neu an?</h2>
        <p className="muted small-text">Nur <b>eine</b> Person erstellt den Haushalt und teilt danach den Code.</p>
        <button
          type="button"
          className="btn secondary big full"
          disabled={!!busy}
          onClick={() => {
            if (window.confirm('Neuen Haushalt erstellen?\n\nWenn dein Partner / deine Partnerin schon einen Haushalt hat, tippe auf „Abbrechen“ und tritt stattdessen mit dem Code bei.')) run('create')
          }}
        >
          {busy === 'create' ? 'Wird erstellt …' : 'Haushalt erstellen'}
        </button>
      </section>
    </div>
  )
}

function LinkStep() {
  const s = useSync()
  const { data } = useStore()
  const count = sync.localCount()
  const isPartner = s.household?.slot === 'p2'
  const [swap, setSwap] = useState(isPartner)
  const [busy, setBusy] = useState(false)
  const autoLinked = useRef(false)
  useEffect(() => {
    if (count === 0 && !autoLinked.current) {
      autoLinked.current = true
      void sync.link('replace')
    }
  }, [count])
  if (count === 0) return <Spinner text="Verbinde mit eurem Haushalt …" />
  const go = async (mode: 'merge' | 'replace') => {
    setBusy(true)
    await sync.link(mode, mode === 'merge' && swap)
    setBusy(false)
  }
  return (
    <div className="auth-step">
      <h1>Bisherige Einträge übernehmen?</h1>
      <p className="auth-lead">Auf diesem iPhone gibt es schon <b>{count} Einträge</b>. Sollen sie in euren gemeinsamen Haushalt übernommen werden? Es wird nichts gelöscht.</p>
      {isPartner && (
        <label className="switch-row auth-swap">
          <span>
            Auf diesem Gerät warst du „{data.settings.persons[0].name}“ (Person 1). Im Haushalt bist du Person 2 – deine Einträge entsprechend zuordnen
          </span>
          <input type="checkbox" className="switch" checked={swap} onChange={(e) => setSwap(e.target.checked)} />
        </label>
      )}
      <button type="button" className="btn primary big full" disabled={busy} onClick={() => go('merge')}>Ja, übernehmen (zusammenführen)</button>
      <button type="button" className="btn secondary full" disabled={busy} onClick={() => go('replace')}>Nein, nur die Haushaltsdaten verwenden</button>
      <p className="muted small-text">Bei „Nein“ bleibt eine Sicherung der bisherigen Daten auf diesem Gerät gespeichert.</p>
    </div>
  )
}

export function InviteCode({ code }: { code: string }) {
  const share = async () => {
    const text = `Komm in unser Haushaltsbuch! Öffne https://ruebennase123-glitch.github.io/ausgaben-app/, melde dich an und gib diesen Code ein: ${code}`
    if (navigator.share) {
      try {
        await navigator.share({ text })
        return
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard?.writeText(code).catch(() => {})
  }
  return (
    <div className="invite">
      <div className="invite-code" aria-label="Einladungscode">{code.slice(0, 3)} {code.slice(3)}</div>
      <button type="button" className="btn secondary full" onClick={share}>📤 Code teilen</button>
    </div>
  )
}

function DoneStep({ onClose }: { onClose: () => void }) {
  const s = useSync()
  const h = s.household
  if (!h) return null
  return (
    <div className="auth-step">
      <h1>{h.memberCount >= 2 ? 'Ihr seid verbunden 🎉' : 'Haushalt ist bereit 🎉'}</h1>
      {h.memberCount < 2 ? (
        <>
          <p className="auth-lead">Schick deinem Partner / deiner Partnerin diesen Einladungscode. Er/sie meldet sich in der App an und wählt „Mit Code beitreten“.</p>
          <InviteCode code={h.inviteCode} />
        </>
      ) : (
        <p className="auth-lead">Alle Einträge werden jetzt automatisch zwischen euren iPhones abgeglichen – auch offline Erfasstes, sobald wieder Internet da ist.</p>
      )}
      <button type="button" className="btn primary big full" onClick={onClose}>Los geht’s</button>
    </div>
  )
}

export function HandoffScreen() {
  const s = useSync()
  return (
    <div className="auth-overlay">
      <div className="auth-inner">
        <div className="auth-step handoff">
          {s.handoff === 'done' ? (
            <>
              <div className="handoff-emoji">✅</div>
              <h1>Angemeldet!</h1>
              <p className="auth-lead">Wechsle jetzt zurück zur <b>Haushaltsbuch-App</b> auf deinem Home-Bildschirm – sie meldet sich automatisch an.</p>
              <p className="muted small-text">Diesen Safari-Tab kannst du schließen.</p>
            </>
          ) : s.handoff === 'error' ? (
            <>
              <div className="handoff-emoji">⚠️</div>
              <h1>Das hat nicht geklappt</h1>
              <p className="auth-lead">{s.error ?? 'Bitte in der App einen neuen Anmeldelink anfordern.'}</p>
            </>
          ) : (
            <Spinner text="Anmeldung wird abgeschlossen …" />
          )}
        </div>
      </div>
    </div>
  )
}
