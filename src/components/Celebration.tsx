import { useMemo } from 'react'
import { store, useStore } from '../data/store'
import { badgeById } from '../logic/badges'

const COLORS = ['#f59e0b', '#22c55e', '#6366f1', '#ec4899', '#0ea5e9', '#ef4444']

export function Celebration() {
  const { data, ui } = useStore()
  const key = ui.celebrations[0]
  const pieces = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        dur: 1.8 + Math.random() * 1.4,
        rot: Math.random() * 360,
        color: COLORS[i % COLORS.length],
        w: 6 + Math.random() * 6,
      })),
    // regenerate per celebration
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  if (!key) return null
  let emoji = '🎉'
  let title = 'Geschafft!'
  let text = ''
  if (key.startsWith('goal:')) {
    const g = data.goals.find((x) => x.id === key.slice(5))
    emoji = g?.emoji ?? '🎯'
    title = 'Sparziel erreicht!'
    text = g ? `„${g.name}“ ist voll – stark gemacht, ihr zwei!` : ''
  } else {
    const b = badgeById(key)
    if (b) {
      emoji = b.emoji
      title = b.title
      text = b.description
    }
  }
  return (
    <div className="celebrate" onClick={() => store.dismissCelebration()} role="dialog" aria-label="Neues Abzeichen">
      <div className="confetti" aria-hidden>
        {pieces.map((p, i) => (
          <span
            key={i}
            style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, background: p.color, width: p.w, height: p.w * 0.45, transform: `rotate(${p.rot}deg)` }}
          />
        ))}
      </div>
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-kicker">Neues Abzeichen</div>
        <div className="celebrate-emoji">{emoji}</div>
        <div className="celebrate-title">{title}</div>
        <div className="celebrate-text">{text}</div>
        <button type="button" className="btn primary big" onClick={() => store.dismissCelebration()}>Juhu! 🎉</button>
      </div>
    </div>
  )
}
