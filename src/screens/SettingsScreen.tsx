import { useRef, useState } from 'react'
import type { Person } from '../types'
import { store, useStore } from '../data/store'
import { Segmented } from '../components/ui'
import { showToast } from '../components/toast'
import { live } from '../logic/stats'
import { today } from '../logic/dates'

const EMOJIS = ['🙂', '😊', '😎', '🦊', '🐻', '🐱', '🌸', '⭐', '🍀', '🚀']

export function SettingsScreen() {
  const { data } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const persons = data.settings.persons

  const setPerson = (i: 0 | 1, patch: Partial<Person>) => {
    const next = [...persons] as [Person, Person]
    next[i] = { ...next[i], ...patch }
    store.updateSettings({ persons: next })
  }

  const doExport = async () => {
    const json = store.exportJSON()
    const name = `ausgaben-backup-${today()}.json`
    const file = new File([json], name, { type: 'application/json' })
    // iPhone: share sheet ("In Dateien sichern", AirDrop …); elsewhere: download
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Ausgaben-Backup' })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('💾 Backup gespeichert')
  }

  const doImport = async (f: File | undefined) => {
    if (!f) return
    try {
      const text = await f.text()
      if (!window.confirm('Backup einspielen? Die aktuellen Daten auf diesem Gerät werden ersetzt.')) return
      store.importJSON(text)
      showToast('✅ Backup erfolgreich eingespielt')
    } catch (e) {
      window.alert(`Import fehlgeschlagen: ${(e as Error).message}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <h1>Einstellungen</h1>
      </header>

      <h3 className="section-title">Wir zwei</h3>
      <section className="card form">
        {persons.map((p, i) => (
          <div key={p.id} className="person-edit">
            <label className="field">
              <span>Person {i + 1}</span>
              <input value={p.name} maxLength={20} onChange={(e) => setPerson(i as 0 | 1, { name: e.target.value })} onBlur={(e) => !e.target.value.trim() && setPerson(i as 0 | 1, { name: i === 0 ? 'Ich' : 'Partnerin' })} />
            </label>
            <div className="emoji-pick small">
              {EMOJIS.map((e) => (
                <button key={e} type="button" className={p.emoji === e ? 'active' : ''} onClick={() => setPerson(i as 0 | 1, { emoji: e })}>{e}</button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <h3 className="section-title">Darstellung</h3>
      <section className="card">
        <Segmented
          value={data.settings.theme}
          onChange={(theme) => store.updateSettings({ theme })}
          options={[
            { value: 'system', label: '⚙️ Auto' },
            { value: 'light', label: '☀️ Hell' },
            { value: 'dark', label: '🌙 Dunkel' },
          ]}
        />
      </section>

      <h3 className="section-title">Datensicherung</h3>
      <section className="card form">
        <p className="muted small-text">
          Eure Daten liegen nur auf diesem Gerät ({live(data).length} Buchungen). Macht ab und zu ein Backup – z. B. in iCloud Drive über „In Dateien sichern“.
        </p>
        <button type="button" className="btn secondary full" onClick={doExport}>💾 Backup exportieren (JSON)</button>
        <button type="button" className="btn secondary full" onClick={() => fileRef.current?.click()}>📥 Backup importieren</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
      </section>

      <InstallHint />

      <h3 className="section-title">Gefahrenzone</h3>
      <section className="card form">
        <button
          type="button"
          className="btn danger full"
          onClick={() => {
            if (window.confirm('Wirklich ALLE Daten auf diesem Gerät löschen? Das kann nicht rückgängig gemacht werden.')) {
              store.resetAll()
              showToast('Alle Daten gelöscht')
            }
          }}
        >
          Alle Daten löschen
        </button>
      </section>
      <p className="footer-note">Haushaltsbuch · Version 1.0 · Offline-fähig · Keine Werbung, kein Tracking</p>
    </div>
  )
}

function InstallHint() {
  const [standalone] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  )
  if (standalone) return null
  return (
    <>
      <h3 className="section-title">Als App installieren</h3>
      <section className="card install-card">
        <ol>
          <li>In <b>Safari</b> unten auf <b>Teilen</b> <span className="share-ico">⬆︎</span> tippen</li>
          <li><b>„Zum Home-Bildschirm“</b> wählen</li>
          <li>Fertig – die App startet jetzt wie eine normale App 🎉</li>
        </ol>
      </section>
    </>
  )
}
