import { useEffect, useState, type ReactNode } from 'react'
import { store, useStore } from './data/store'
import { EntryScreen } from './screens/EntryScreen'
import { OverviewScreen } from './screens/OverviewScreen'
import { PlanScreen } from './screens/PlanScreen'
import { AchievementsScreen } from './screens/AchievementsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { Celebration } from './components/Celebration'
import { IconChart, IconGear, IconPlus, IconTarget, IconTrophy } from './components/Icons'
import { hideToast, onToast, type ToastMsg } from './components/toast'

type Tab = 'entry' | 'overview' | 'plan' | 'goals' | 'settings'
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Übersicht', icon: <IconChart /> },
  { id: 'plan', label: 'Planen', icon: <IconTarget /> },
  { id: 'entry', label: 'Erfassen', icon: <IconPlus size={28} /> },
  { id: 'goals', label: 'Erfolge', icon: <IconTrophy /> },
  { id: 'settings', label: 'Mehr', icon: <IconGear /> },
]

function initialTab(): Tab {
  const h = location.hash.slice(1) as Tab
  return TABS.some((t) => t.id === h) ? h : 'entry'
}

export default function App() {
  const { data, ui } = useStore()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [toast, setToast] = useState<ToastMsg | null>(null)

  useEffect(() => onToast(setToast), [])
  useEffect(() => {
    history.replaceState(null, '', `#${tab}`)
    window.scrollTo(0, 0)
  }, [tab])

  // Theme
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const dark = data.settings.theme === 'dark' || (data.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      root.dataset.theme = dark ? 'dark' : 'light'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1115' : '#f6f5f2')
    }
    apply()
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [data.settings.theme])

  // New day / back from background -> generate due recurring entries
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && store.refresh()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  if (!ui.ready) return <div className="splash">💶</div>

  return (
    <div className="app">
      <main className="content">
        {ui.storageError && <div className="banner">{ui.storageError}</div>}
        {tab === 'entry' && <EntryScreen />}
        {tab === 'overview' && <OverviewScreen />}
        {tab === 'plan' && <PlanScreen />}
        {tab === 'goals' && <AchievementsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      {toast && (
        <div className={`toast ${toast.tone ?? 'ok'}`} key={toast.id} role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action!.run()
                hideToast()
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      <nav className="tabbar" aria-label="Navigation">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${t.id === 'entry' ? 'tab-main' : ''} ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <Celebration />
    </div>
  )
}
