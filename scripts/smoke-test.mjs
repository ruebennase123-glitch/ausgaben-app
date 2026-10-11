// End-to-end smoke test against the production build on a fresh (empty) profile.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-DE', acceptDownloads: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('dialog', (d) => d.accept())
const data = () => page.evaluate(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')))

await page.goto(BASE + '/')
await page.waitForSelector('.keypad')
assert.equal(await page.locator('.btn.primary.big').innerText(), 'Betrag eingeben')

// 1) Fast entry: 12,5 € Lebensmittel
for (const k of ['1', '2', ',', '5']) await page.getByRole('button', { name: k, exact: true }).click()
await page.getByRole('radio', { name: /Lebensmittel/ }).click()
await page.locator('.btn.primary.big').click()
await page.waitForSelector('.celebrate-card') // badge "Erster Eintrag"
assert.match(await page.locator('.celebrate-title').innerText(), /Erster Eintrag/)
await page.getByText('Juhu!').click()
let d = await data()
assert.equal(d.transactions.length, 1)
assert.equal(d.transactions[0].amountCents, 1250)
console.log('✓ Ausgabe erfasst + Abzeichen')

// 2) Income
await page.getByRole('radio', { name: 'Einnahme' }).click()
for (const k of ['5', '0']) await page.getByRole('button', { name: k, exact: true }).click()
await page.locator('.btn.primary.big').click()
d = await data()
assert.equal(d.transactions.filter((t) => t.type === 'income').length, 1)
console.log('✓ Einnahme erfasst')

// 3) Overview balance = 50 - 12.5
await page.locator('.tabbar').getByText('Übersicht', { exact: true }).click()
assert.match(await page.locator('.balance-value').innerText(), /37,50/)
console.log('✓ Saldo korrekt')

// 4) Edit -> delete
await page.locator('.tx-row').first().click()
await page.getByLabel('Buchung löschen').click()
d = await data()
assert.equal(d.transactions.filter((t) => !t.deleted).length, 1)
console.log('✓ Löschen (Soft-Delete)')

// 5) Budget
await page.locator('.tabbar').getByText('Planen', { exact: true }).click()
await page.locator('.nobudget-row').first().click()
await page.getByText('200 €', { exact: true }).click()
await page.getByText('Budget speichern').click()
d = await data()
assert.equal(Object.values(d.budgets)[0].limitCents, 20000)
if (await page.locator('.celebrate-card').count()) await page.getByText('Juhu!').click()
console.log('✓ Budget gesetzt')

// 6) Recurring rule -> generates entry for this month when the day has passed
await page.getByRole('radio', { name: /Fixkosten/ }).click()
await page.getByText('Fixkosten / Einnahme hinzufügen').click()
await page.getByPlaceholder('z. B. Miete').fill('Miete')
await page.getByPlaceholder('0,00').fill('900')
await page.locator('.sheet select').selectOption('1')
await page.locator('.sheet').getByText('Speichern', { exact: true }).click()
d = await data()
assert.equal(d.recurring.length, 1)
assert.equal(d.transactions.filter((t) => t.recurringId).length, 1)
// reload: must not duplicate
await page.reload()
await page.waitForSelector('.tabbar')
d = await data()
assert.equal(d.transactions.filter((t) => t.recurringId).length, 1)
console.log('✓ Fixkosten erzeugen genau eine Buchung pro Monat')

// 7) Goal + contribution reaching target -> celebration
await page.locator('.tabbar').getByText('Erfolge', { exact: true }).click()
await page.locator('.section-head').getByText('Neu').click()
await page.getByPlaceholder('z. B. Sommerurlaub').fill('Test-Ziel')
await page.getByPlaceholder('z. B. 2000').fill('100')
await page.locator('.sheet').getByText('Speichern', { exact: true }).click()
while (await page.locator('.celebrate-card').count()) await page.getByText('Juhu!').click()
await page.getByText('+ Einzahlen').click()
await page.locator('.sheet').getByText('100 €', { exact: true }).click()
await page.locator('.sheet').getByText('Einzahlen', { exact: true }).click()
await page.waitForSelector('.celebrate-card')
const titles = []
while (await page.locator('.celebrate-card').count()) {
  titles.push(await page.locator('.celebrate-title').innerText())
  await page.getByText('Juhu!').click()
}
assert.ok(titles.some((t) => /Ziel erreicht|Sparziel erreicht/.test(t)), titles.join(','))
console.log('✓ Sparziel erreicht + Feier:', titles.join(' / '))

// 8) Check-in for the other person
await page.getByText('Heute nichts ausgegeben').first().click()
d = await data()
assert.equal(d.checkins.length, 1)
while (await page.locator('.celebrate-card').count()) await page.getByText('Juhu!').click()
console.log('✓ Check-in')

// 8b) 'Gemeinsam' (joint account) everywhere a payer is picked
const dismiss = async () => { while (await page.locator('.celebrate-card').count()) await page.getByText('Juhu!').click() }
await page.locator('.tabbar').getByText('Erfassen', { exact: true }).click()
await page.getByRole('radio', { name: 'Ausgabe' }).click()
for (const k of ['3', '0']) await page.getByRole('button', { name: k, exact: true }).click()
await page.getByRole('radio', { name: /Lebensmittel/ }).click()
await page.getByRole('radio', { name: /Gemeinsam/ }).click()
await page.locator('.btn.primary.big').click()
await dismiss()
d = await data()
assert.equal(d.transactions.at(-1).personId, 'joint')
console.log('✓ Neue Buchung als Gemeinsam')

await page.locator('.tabbar').getByText('Übersicht', { exact: true }).click()
await page.locator('.person-filter').getByRole('radio', { name: /Gemeinsam/ }).click()
const jointRows = await page.locator('.tx-row .tx-sub').allInnerTexts()
assert.ok(jointRows.length >= 1 && jointRows.every((t) => t.includes('Gemeinsam')), jointRows.join('|'))
await page.locator('.person-filter').getByRole('radio', { name: 'Beide' }).click()
const allRows = await page.locator('.tx-row').count()
assert.ok(allRows > jointRows.length)
console.log(`✓ Filter Gemeinsam (${jointRows.length}) / Beide (${allRows})`)

// edit an entry -> switch payer to Gemeinsam
await page.locator('.tx-row', { hasNotText: 'Gemeinsam' }).first().click()
await page.locator('.sheet').getByRole('radio', { name: /Gemeinsam/ }).click()
await page.locator('.sheet').getByText('Änderung speichern').click()
d = await data()
assert.equal(d.transactions.filter((t) => !t.deleted && t.personId === 'joint').length, 2)
console.log('✓ Buchung bearbeiten → Gemeinsam')

await page.locator('.tabbar').getByText('Planen', { exact: true }).click()
await page.getByRole('radio', { name: /Fixkosten/ }).click()
await page.getByText('Fixkosten / Einnahme hinzufügen').click()
await page.getByPlaceholder('z. B. Miete').fill('Strom')
await page.getByPlaceholder('0,00').fill('85')
await page.locator('.sheet').getByRole('radio', { name: /Gemeinsam/ }).click()
await page.locator('.sheet').getByText('Speichern', { exact: true }).click()
d = await data()
assert.equal(d.recurring.find((r) => r.note === 'Strom').personId, 'joint')
console.log('✓ Fixkosten mit Gemeinsam')

await page.locator('.tabbar').getByText('Erfolge', { exact: true }).click()
await page.locator('.section-head').getByText('Neu').click()
await page.getByPlaceholder('z. B. Sommerurlaub').fill('Urlaub')
await page.getByPlaceholder('z. B. 2000').fill('500')
await page.locator('.sheet').getByText('Speichern', { exact: true }).click()
await dismiss()
await page.getByText('+ Einzahlen').click()
await page.locator('.sheet').getByText('50 €', { exact: true }).click()
await page.locator('.sheet').getByRole('radio', { name: /Gemeinsam/ }).click()
await page.locator('.sheet').getByText('Einzahlen', { exact: true }).click()
await dismiss()
d = await data()
assert.equal(d.goals.find((g) => g.name === 'Urlaub').contributions[0].personId, 'joint')
assert.ok((await page.locator('.recap-person', { hasText: 'Gemeinsam' }).count()) === 1, 'Wochenrückblick-Zeile Gemeinsam')
console.log('✓ Sparziel-Einzahlung Gemeinsam + eigene Zeile im Wochenrückblick')

await page.locator('.tabbar').getByText('Mehr', { exact: true }).click()
await page.getByLabel('Name Gemeinschaftskonto').fill('Gemeinschaftskonto')
d = await data()
assert.equal(d.settings.joint.name, 'Gemeinschaftskonto')
await page.getByLabel('Name Gemeinschaftskonto').fill('Gemeinsam')
console.log('✓ Bezeichnung Gemeinsam editierbar')

// 8c) Migration of v1.0 data (no joint payer) + joint entries credit only the shared streak
{
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' })
  const p2 = await c2.newPage()
  p2.on('pageerror', (e) => errors.push(e.message))
  const day = (o) => { const x = new Date(); x.setDate(x.getDate() + o); x.setHours(12); return x }
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const tx = (o, person) => ({ id: 'legacy-' + o + person, createdAt: day(o).toISOString(), updatedAt: day(o).toISOString(), type: 'expense', amountCents: 1000, categoryId: 'lebensmittel', personId: person, date: iso(day(o)) })
  const legacy = {
    schemaVersion: 1, transactions: [tx(-2, 'p1')], recurring: [], goals: [], checkins: [], budgets: {}, badges: { first_entry: day(-2).toISOString() },
    settings: { persons: [{ id: 'p1', name: 'Max', emoji: '😎' }, { id: 'p2', name: 'Lea', emoji: '🌸' }], theme: 'light', lastPersonId: 'p2', updatedAt: day(-2).toISOString() },
  }
  await p2.addInitScript((j) => { if (!sessionStorage.getItem('s')) { localStorage.setItem('ausgaben-app:v1', j); sessionStorage.setItem('s', '1') } }, JSON.stringify(legacy))
  await p2.goto(BASE + '/#goals')
  await p2.waitForSelector('.streak-num')
  let m = await p2.evaluate(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')))
  assert.deepEqual(m.settings.joint, { id: 'joint', name: 'Gemeinsam', emoji: '🤝' })
  assert.equal(m.transactions[0].personId, 'p1')
  assert.equal(m.settings.persons[0].name, 'Max')
  console.log('✓ Migration alter Daten (joint ergänzt, Buchungen unverändert)')
  // joint entries yesterday + today -> shared streak 2 (day -2 by p1 => 3), Julian 0 (gap), Sarah 0
  m.transactions.push(tx(-1, 'joint'), tx(0, 'joint'))
  await p2.evaluate((j) => localStorage.setItem('ausgaben-app:v1', j), JSON.stringify(m))
  await p2.reload()
  await p2.waitForSelector('.streak-num')
  assert.match(await p2.locator('.streak-num').innerText(), /^3 Tage/)
  const per = await p2.locator('.streak-person b').allInnerTexts()
  assert.deepEqual(per.map((t) => t.trim()), ['0 🔥', '0 🔥'])
  console.log('✓ Gemeinsam-Buchungen zählen für die gemeinsame Serie (nicht persönlich)')
  await c2.close()
}

// 9) Rename person, export, reset, import
await page.locator('.tabbar').getByText('Mehr', { exact: true }).click()
await page.locator('.person-edit input').nth(1).fill('Julia')
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('Backup exportieren (JSON)').click()])
const path = '/tmp/ausgaben-backup-test.json'
await dl.saveAs(path)
const backup = JSON.parse(readFileSync(path, 'utf8'))
assert.equal(backup.app, 'ausgaben-app')
assert.equal(backup.data.settings.persons[1].name, 'Julia')
await page.getByText('Alle Daten löschen').click()
d = await data()
assert.equal(d.transactions.length, 0)
await page.locator('input[type=file]').setInputFiles(path)
await page.waitForTimeout(300)
d = await data()
assert.equal(d.settings.persons[1].name, 'Julia')
assert.ok(d.transactions.length >= 3)
console.log('✓ Export / Reset / Import')

// 10) PWA basics
const manifest = await (await page.request.get(BASE + '/manifest.webmanifest')).json()
assert.equal(manifest.display, 'standalone')
assert.equal((await page.request.get(BASE + '/sw.js')).status(), 200)
assert.equal((await page.request.get(BASE + '/apple-touch-icon.png')).status(), 200)
const swActive = await page.evaluate(async () => !!(await navigator.serviceWorker.ready.then((r) => r.active)))
assert.ok(swActive)
console.log('✓ Manifest, Service Worker aktiv, Icons')

// 11) Offline: reload with network off
await ctx.setOffline(true)
await page.reload()
await page.waitForSelector('.tabbar')
console.log('✓ Startet offline')

assert.deepEqual(errors, [])
console.log('\nAlle Smoke-Tests bestanden.')
await browser.close()
