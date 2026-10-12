import { useCallback, useEffect, useState } from 'react'
import { sync, useSync } from './engine'
import { VAPID_PUBLIC_KEY } from './config'

type Prefs = { evening_enabled: boolean; evening_time: string; monthly_enabled: boolean; partner_enabled: boolean; budget_enabled: boolean }
const DEFAULTS: Prefs = { evening_enabled: true, evening_time: '20:30', monthly_enabled: true, partner_enabled: false, budget_enabled: true }

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

function b64ToBytes(s: string) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}
const toB64 = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '')

async function currentSub() {
  if (!supported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

const TOGGLES: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'evening_enabled', label: 'Abend-Erinnerung', hint: 'Nur wenn du heute noch nichts eingetragen hast und deine Serie in Gefahr ist.' },
  { key: 'monthly_enabled', label: 'Monatsbericht', hint: 'Am 1. um ca. 9 Uhr: Saldo und Top-Kategorie vom Vormonat.' },
  { key: 'partner_enabled', label: 'Partner hat etwas eingetragen', hint: 'Gesammelt, nicht bei jedem einzelnen Eintrag.' },
  { key: 'budget_enabled', label: 'Budget-Warnung', hint: 'Bei 80 % und 100 % eines Kategorie-Budgets.' },
]

export function PushSettings() {
  const s = useSync()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const ready = s.phase === 'ready' && !!s.household

  const load = useCallback(async () => {
    const sub = await currentSub().catch(() => null)
    setSubscribed(!!sub)
    if (!ready) return
    const { data } = await sync.sb.from('notification_prefs').select('evening_enabled,evening_time,monthly_enabled,partner_enabled,budget_enabled').maybeSingle()
    if (data) setPrefs({ ...data, evening_time: String(data.evening_time).slice(0, 5) } as Prefs)
  }, [ready])
  useEffect(() => {
    load().catch(() => {})
  }, [load])

  const activate = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt. Du kannst sie in den iPhone-Einstellungen unter „Mitteilungen“ freigeben.')
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) }))
      const { error } = await sync.sb.rpc('register_push_subscription', {
        p_endpoint: sub.endpoint, p_p256dh: toB64(sub.getKey('p256dh')), p_auth: toB64(sub.getKey('auth')), p_user_agent: navigator.userAgent.slice(0, 200),
      })
      if (error) throw new Error(error.message)
      setSubscribed(true)
      setMsg('✓ Benachrichtigungen sind aktiv.')
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const deactivate = async () => {
    setBusy(true)
    try {
      const sub = await currentSub()
      if (sub) {
        await sync.sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setSubscribed(false)
      setMsg('Benachrichtigungen auf diesem Gerät deaktiviert.')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const { data, error } = await sync.sb.functions.invoke('push-dispatch', { body: { action: 'test' } })
      if (error) throw error
      setMsg(data?.sent ? '✓ Testbenachrichtigung gesendet – sie kommt in wenigen Sekunden.' : 'Kein aktives Gerät gefunden.')
    } catch {
      setMsg('Test fehlgeschlagen. Bitte später erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  const update = async (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    const { error } = await sync.sb.from('notification_prefs').update(patch).not('user_id', 'is', null)
    if (error) setMsg('Speichern fehlgeschlagen.')
  }

  if (s.phase === 'disabled') return null
  return (
    <>
      <h3 className="section-title">Benachrichtigungen</h3>
      <section className="card form push-card" data-testid="push-settings">
        {!supported() || (isIOS() && !standalone()) ? (
          <p className="muted small-text">
            Benachrichtigungen funktionieren auf dem iPhone nur, wenn die App über <b>Teilen → „Zum Home-Bildschirm“</b> installiert ist (ab iOS 16.4). Öffne sie dann vom Home-Bildschirm und aktiviere sie hier.
          </p>
        ) : !ready ? (
          <p className="muted small-text">Melde dich oben an und verbinde einen Haushalt, um Benachrichtigungen zu nutzen.</p>
        ) : !subscribed ? (
          <>
            <p className="muted small-text">Erinnerungen, Monatsbericht und Budget-Warnungen direkt aufs Handy. Funktioniert nur in der installierten App (Home-Bildschirm).</p>
            <button type="button" className="btn primary full" disabled={busy} onClick={activate}>🔔 Aktivieren</button>
          </>
        ) : (
          <>
            {TOGGLES.map((t) => (
              <div key={t.key}>
                <label className="switch-row">
                  <span>{t.label}</span>
                  <input type="checkbox" className="switch" aria-label={t.label} checked={!!prefs[t.key]} onChange={(e) => update({ [t.key]: e.target.checked })} />
                </label>
                <p className="muted small-text">{t.hint}</p>
                {t.key === 'evening_enabled' && prefs.evening_enabled && (
                  <label className="field">
                    <span>Uhrzeit</span>
                    <input type="time" aria-label="Uhrzeit Abend-Erinnerung" value={prefs.evening_time} step={300} onChange={(e) => e.target.value && update({ evening_time: e.target.value })} />
                  </label>
                )}
              </div>
            ))}
            <button type="button" className="btn full" disabled={busy} onClick={test}>Testbenachrichtigung senden</button>
            <button type="button" className="btn ghost full" disabled={busy} onClick={deactivate}>Auf diesem Gerät deaktivieren</button>
          </>
        )}
        {msg && <p className="small-text" role="status">{msg}</p>}
      </section>
    </>
  )
}
