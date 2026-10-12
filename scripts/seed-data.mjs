// Realistic sample data – used ONLY by scripts/screenshots.mjs (injected into
// localStorage of the headless browser). The app itself starts empty.
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
let n = 0
const id = (p) => `${p}-${(++n).toString(36).padStart(6, '0')}-seed`

export function buildSeed(now = new Date()) {
  const day = (offset) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    return d
  }
  const stamp = (d, h = 19, m = 12) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString()
  const cm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  const prev = (k) => {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  }

  const tx = []
  const add = (offset, type, eur, cat, person, note, h = 19) => {
    const d = day(offset)
    const t = stamp(d, h, (offset * 7 + 60) % 60)
    tx.push({ id: id('tx'), createdAt: t, updatedAt: t, type, amountCents: Math.round(eur * 100), categoryId: cat, personId: person, note, date: iso(d) })
  }

  // ---- this month & the last 14 days: logged every day (streak) ----
  const recent = [
    [0, 'expense', 24.9, 'lebensmittel', 'p1', 'Wochenmarkt'],
    [0, 'expense', 4.2, 'restaurant', 'p2', 'Cappuccino'],
    [-1, 'expense', 68.4, 'restaurant', 'p2', 'Pizza mit Freunden'],
    [-1, 'expense', 12.99, 'freizeit', 'p1', 'Kino'],
    [-2, 'expense', 87.35, 'lebensmittel', 'joint', 'REWE Wocheneinkauf'],
    [-3, 'expense', 39.9, 'kleidung', 'p2', 'Pullover'],
    [-3, 'expense', 6.5, 'lebensmittel', 'p2', 'Bäcker'],
    [-4, 'expense', 52.0, 'mobilitaet', 'p1', 'Tanken'],
    [-5, 'expense', 45.8, 'restaurant', 'p1', 'Sushi'],
    [-5, 'expense', 19.95, 'gesundheit', 'p2', 'Apotheke'],
    [-6, 'expense', 112.6, 'lebensmittel', 'joint', 'Großeinkauf dm + Aldi'],
    [-7, 'expense', 29.0, 'geschenke', 'p1', 'Geburtstag Mama'],
    [-4, 'expense', 64.9, 'renovieren', 'joint', 'Farbe + Pinsel Baumarkt'],
    [-9, 'expense', 189.0, 'urlaub-gemeinsam', 'joint', 'Ferienwohnung Anzahlung'],
    [-12, 'expense', 45.0, 'urlaub', 'p1', 'Wochenende Hamburg Zugticket'],
    [-3, 'expense', 73.4, 'lebensmittel', 'joint', 'Wocheneinkauf geliefert'],
    [-10, 'expense', 27.5, 'lieferando', 'p2', 'Pizza-Abend'],
    [-1, 'expense', 38.0, 'dating', 'p1', 'Date-Night Weinbar'],
    [-8, 'expense', 34.5, 'freizeit', 'p2', 'Kletterhalle'],
    [-8, 'expense', 22.3, 'lebensmittel', 'p1', 'Edeka'],
    [-9, 'expense', 41.2, 'restaurant', 'p2', 'Thai Imbiss'],
    [-10, 'expense', 58.75, 'lebensmittel', 'p1', 'REWE'],
    [-11, 'income', 80, 'einnahme-sonstiges', 'p2', 'Kleinanzeigen Verkauf'],
    [-11, 'expense', 14.0, 'sonstiges', 'p1', 'Paket Porto'],
    [-12, 'expense', 31.4, 'lebensmittel', 'p2', 'Markt'],
    [-13, 'expense', 9.99, 'freizeit', 'p1', 'Buch'],
  ]
  for (const r of recent) if (iso(day(r[0])) >= `${prev(1)}-01`) add(...r)

  // ---- previous month: under budget in every category ----
  const pm = prev(1)
  const [py, pmo] = pm.split('-').map(Number)
  const prevMonthTx = [
    [3, 'expense', 96.4, 'lebensmittel', 'p1', 'REWE'],
    [6, 'expense', 38.0, 'restaurant', 'p2', 'Italiener'],
    [8, 'expense', 74.1, 'lebensmittel', 'p2', 'Aldi + dm'],
    [11, 'expense', 49.0, 'mobilitaet', 'p1', 'Tanken'],
    [13, 'expense', 25.0, 'freizeit', 'p2', 'Konzert Vorverkauf'],
    [15, 'expense', 88.9, 'lebensmittel', 'p1', 'Wocheneinkauf'],
    [18, 'expense', 59.99, 'kleidung', 'p1', 'Sneaker (Sale)'],
    [20, 'expense', 42.5, 'restaurant', 'p1', 'Burger'],
    [22, 'expense', 101.3, 'lebensmittel', 'p2', 'Großeinkauf'],
    [24, 'expense', 15.0, 'gesundheit', 'p2', 'Zuzahlung'],
    [26, 'expense', 32.0, 'freizeit', 'p1', 'Minigolf'],
    [27, 'expense', 64.2, 'lebensmittel', 'p1', 'REWE'],
  ]
  for (const [d, type, eur, cat, p, note] of prevMonthTx) {
    const date = new Date(py, pmo - 1, d)
    if (iso(date) >= iso(day(-13))) continue // already covered by "recent"
    const t = stamp(date, 20, d)
    tx.push({ id: id('tx'), createdAt: t, updatedAt: t, type, amountCents: Math.round(eur * 100), categoryId: cat, personId: p, note, date: iso(date) })
  }

  const t0 = stamp(day(-70), 18)
  const rule = (type, eur, cat, person, note, dayOfMonth) => ({
    id: id('rec'), createdAt: t0, updatedAt: t0, type, amountCents: Math.round(eur * 100), categoryId: cat, personId: person, note, dayOfMonth, startMonth: prev(1), active: true,
  })
  const recurring = [
    rule('income', 2650, 'gehalt', 'p1', 'Gehalt Lukas', 1),
    rule('income', 2380, 'gehalt', 'p2', 'Gehalt Anna', 1),
    rule('expense', 1150, 'wohnen', 'joint', 'Warmmiete', 1),
    rule('expense', 116, 'mobilitaet', 'p1', '2× Deutschlandticket', 1),
    rule('expense', 85, 'wohnen', 'joint', 'Strom', 3),
    rule('expense', 28.98, 'abos', 'p2', 'Netflix + Spotify', 5),
    rule('expense', 24.99, 'abos', 'p1', 'Handyverträge', 15),
  ]

  const b = (cat, eur) => [cat, { categoryId: cat, limitCents: eur * 100, updatedAt: t0 }]
  const budgets = Object.fromEntries([
    b('lebensmittel', 450), b('restaurant', 150), b('freizeit', 120), b('kleidung', 100), b('mobilitaet', 200), b('abos', 60), b('gesundheit', 60), b('urlaub', 250),
  ])

  const contrib = (person, eur, off) => ({ id: id('c'), personId: person, amountCents: eur * 100, date: iso(day(off)) })
  const goals = [
    {
      id: id('goal'), createdAt: t0, updatedAt: t0, name: 'Sommerurlaub Portugal', emoji: '✈️', targetCents: 240000,
      contributions: [contrib('p1', 400, -60), contrib('p2', 400, -58), contrib('p1', 250, -30), contrib('p2', 300, -29), contrib('p1', 100, -5), contrib('p2', 110, -2), contrib('joint', 150, -1)],
    },
    {
      id: id('goal'), createdAt: t0, updatedAt: t0, name: 'Neues Sofa', emoji: '🛋️', targetCents: 90000,
      contributions: [contrib('p1', 300, -55), contrib('p2', 300, -50), contrib('p1', 150, -20), contrib('p2', 150, -18)],
      reachedAt: stamp(day(-18), 21),
    },
    {
      id: id('goal'), createdAt: stamp(day(-9)), updatedAt: stamp(day(-9)), name: 'Notgroschen', emoji: '🛟', targetCents: 300000,
      contributions: [contrib('p1', 200, -9), contrib('p2', 150, -3)],
    },
  ]

  const checkins = [] // all recent days already have entries
  const bd = (k, off) => [k, stamp(day(off), 19, 30)]
  const badges = Object.fromEntries([
    bd('first_entry', -68), bd('budget_set', -68), bd('first_goal', -68), bd('team', -66), bd('streak_3', -40),
    bd('streak_7', -6), bd('goal_reached', -18), bd('month_budget', -11),
  ])

  return {
    schemaVersion: 1,
    transactions: tx,
    recurring,
    goals,
    checkins,
    budgets,
    badges,
    settings: {
      persons: [
        { id: 'p1', name: 'Lukas', emoji: '😎' },
        { id: 'p2', name: 'Anna', emoji: '🌸' },
      ],
      theme: 'light',
      lastPersonId: 'p1',
      updatedAt: t0,
    },
    _cm: cm,
  }
}
