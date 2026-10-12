// End-to-end sync test with two separate browser contexts ("iPhone A" and "iPhone B").
// No real emails are sent: the OTP request is intercepted and the magic link is generated with the
// Supabase admin API (secret key is read at runtime from a local file outside the repo, never logged).
// Test users + their household are deleted afterwards.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const BASE = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '')
const SECRETS = process.env.SECRETS_FILE || '/home/box/.config/ausgaben-app/secrets.env'
const env = Object.fromEntries(
  readFileSync(SECRETS, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const REF = env.SUPABASE_PROJECT_REF
const API = `https://${REF}.supabase.co`
const SECRET = env.SUPABASE_SECRET_KEY
assert.ok(REF && SECRET, 'Konfiguration fehlt')

const admin = async (path, init = {}) => {
  const r = await fetch(`${API}/auth/v1/admin${path}`, { ...init, headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' } })
  const t = await r.text()
  if (!r.ok) throw new Error(`admin ${path}: HTTP ${r.status}`)
  return t ? JSON.parse(t) : null
}
// Service-role REST (bypasses RLS) – only ever used with ids of the test users/households created here
const rest = async (path, init = {}) => {
  const r = await fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Prefer: 'count=exact', ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`rest ${path.split('?')[0]}: HTTP ${r.status}`)
  return { rows: r.status === 204 ? [] : await r.json(), count: Number(r.headers.get('content-range')?.split('/')[1] ?? NaN) }
}
const count = async (table, filter, col = table === 'household_members' ? 'user_id' : 'id') => (await rest(`${table}?select=${col}&${filter}`, { headers: { Range: '0-0' } })).count

const rnd = Math.random().toString(36).slice(2, 8)
const users = { A: { email: `e2e-a-${rnd}@example.com` }, B: { email: `e2e-b-${rnd}@example.com` } }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })
const errors = []
let householdId
const t0 = Date.now()
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`)

async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-DE' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('dialog', (d) => d.accept())
  if (process.env.DEBUG_CONSOLE) page.on('console', (m) => ['warning', 'error'].includes(m.type()) && console.log(`  [${name} console] ${m.text().slice(0, 300)}`))
  return { ctx, page, name }
}
const data = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')))
const liveTx = async (page) => (await data(page)).transactions.filter((t) => !t.deleted)

async function addExpense(page, digits, category) {
  await page.locator('.tabbar').getByText('Erfassen', { exact: true }).click()
  for (const k of digits) await page.getByRole('button', { name: k, exact: true }).click()
  await page.locator(`.chips .chip[data-name="${category}"]`).first().click()
  await page.locator('.btn.primary.big').click()
  await page.waitForTimeout(300)
  while (await page.locator('.celebrate-card').count()) {
    await page.locator('.celebrate-card button').last().click()
    await page.waitForTimeout(300)
  }
}

/** Full login like on the iPhone: email in the app → link opened in "Safari" (other context) → app picks up the session. */
async function login(dev, u) {
  let redirectTo
  await dev.page.route('**/auth/v1/otp**', async (route) => {
    const url = new URL(route.request().url())
    redirectTo = url.searchParams.get('redirect_to') || JSON.parse(route.request().postData() || '{}').redirect_to
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' })
  })
  await dev.page.getByPlaceholder('name@beispiel.de').fill(u.email)
  await dev.page.getByRole('button', { name: 'Anmeldelink senden' }).click()
  await dev.page.getByText('Schau in dein Postfach').waitFor()
  assert.ok(redirectTo && redirectTo.startsWith(BASE + '/?pair='), 'redirect_to mit pair-Secret')
  log(`${dev.name}: Anmeldelink angefordert (Wartebildschirm sichtbar)`)
  const link = await admin('/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email: u.email, redirect_to: redirectTo }) })
  const actionLink = link.action_link || link.properties?.action_link
  assert.ok(actionLink)
  // "Safari": separate browser context, opens the link from the email
  const safari = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'de-DE' })
  const sp = await safari.newPage()
  sp.on('pageerror', (e) => errors.push(`${dev.name}/Safari: ${e.message}`))
  await sp.goto(actionLink)
  await sp.getByText('Angemeldet!').waitFor({ timeout: 20000 })
  assert.ok(!(sp.url().includes('access_token')), 'Tokens aus der Adresszeile entfernt')
  assert.equal(await sp.evaluate(() => localStorage.getItem('ausgaben-app:auth')), null, 'Safari speichert keine Sitzung')
  await safari.close()
  log(`${dev.name}: Link in „Safari“ geöffnet → „Angemeldet!“`)
  await dev.page.getByText('Euer gemeinsamer Haushalt').waitFor({ timeout: 20000 })
  log(`${dev.name}: App hat die Anmeldung übernommen (Haushalt erstellen / beitreten)`)
  await dev.page.unroute('**/auth/v1/otp**')
}

const A = await device('A')
const B = await device('B')
try {
  // Users are created confirmed via the admin API (no email traffic)
  for (const u of Object.values(users)) u.id = (await admin('/users', { method: 'POST', body: JSON.stringify({ email: u.email, email_confirm: true }) })).id
  log('Testnutzer angelegt')

  // --- A: has local data from before, then signs in and creates the household
  await A.page.goto(BASE + '/')
  await A.page.getByRole('button', { name: /ohne Konto/ }).click()
  await addExpense(A.page, ['1', '9', ',', '9', '0'], 'Einkäufe')
  await A.page.locator('.tabbar').getByText('Mehr', { exact: true }).click()
  await A.page.locator('.sync-card').getByRole('button', { name: 'Anmelden mit E-Mail' }).click()
  await login(A, users.A)
  await A.page.locator('.auth-overlay').getByRole('button', { name: /Haushalt erstellen/ }).click()
  await A.page.getByText('Bisherige Einträge übernehmen?').waitFor()
  await A.page.getByRole('button', { name: /Ja, übernehmen/ }).click()
  await A.page.getByText('Haushalt ist bereit').waitFor()
  const code = (await A.page.locator('.auth-overlay .invite-code').innerText()).replace(/\s/g, '')
  assert.match(code, /^[A-Z2-9]{6}$/)
  householdId = JSON.parse(await A.page.evaluate(() => localStorage.getItem('ausgaben-app:sync'))).householdId
  log(`A: Haushalt erstellt, Einladungscode ${code}, lokale Daten übernommen`)
  await A.page.getByRole('button', { name: 'Los geht’s' }).click()

  // --- B: fresh iPhone, onboarding → login → join with code
  await B.page.goto(BASE + '/')
  await B.page.getByRole('button', { name: 'Anmelden mit E-Mail' }).click()
  await login(B, users.B)
  // Reproduce the real-world mix-up: B creates an own household instead of joining …
  await B.page.locator('.auth-overlay').getByRole('button', { name: 'Haushalt erstellen' }).click()
  await B.page.getByText('Haushalt ist bereit').waitFor({ timeout: 20000 })
  await B.page.getByRole('button', { name: 'Los geht’s' }).click()
  const ownB = JSON.parse(await B.page.evaluate(() => localStorage.getItem('ausgaben-app:sync'))).householdId
  log('B: hat versehentlich einen eigenen Haushalt erstellt (1 von 2)')
  // … and switches via Mehr → „Anderem Haushalt beitreten“
  await B.page.locator('.tabbar').getByText('Mehr', { exact: true }).click()
  await B.page.getByRole('button', { name: /Anderem Haushalt beitreten/ }).click()
  await B.page.getByLabel('Code des anderen Haushalts').fill(code)
  await B.page.locator('.switch-household').getByRole('button', { name: 'Beitreten' }).click()
  const outcome = await Promise.race([
    B.page.getByText('Ihr seid verbunden').waitFor({ timeout: 20000 }).then(() => 'switched'),
    B.page.locator('.switch-household .auth-error').waitFor({ timeout: 20000 }).then(async () => B.page.locator('.switch-household .auth-error').innerText()),
  ])
  if (outcome === 'switched') {
    log('B: per „Anderem Haushalt beitreten“ gewechselt')
    assert.equal(await count('households', `id=eq.${ownB}`), 0, 'leerer 1-Personen-Haushalt entfernt')
  } else {
    assert.match(outcome, /noch nicht freigeschaltet/)
    log('B: Wechsel-RPC (Migration 0004) noch nicht auf dem Server – Ersatzweg: leeren Haushalt serverseitig entfernen')
    assert.equal(await count('household_members', `household_id=eq.${ownB}`), 1)
    await rest(`households?id=eq.${ownB}&created_by=eq.${users.B.id}`, { method: 'DELETE' })
    await B.page.locator('.sync-card').getByRole('button', { name: /Jetzt synchronisieren/ }).click()
    await B.page.getByText('nicht mehr verbunden').waitFor({ timeout: 20000 })
    await B.page.locator('.auth-overlay').getByLabel('Einladungscode').fill(code.toLowerCase())
    await B.page.locator('.auth-overlay').getByRole('button', { name: /Mit Code beitreten/ }).click()
  }
  await B.page.getByText('Ihr seid verbunden').waitFor({ timeout: 20000 })
  await B.page.getByRole('button', { name: 'Los geht’s' }).click()
  log('B: mit Code beigetreten → „Ihr seid verbunden 🎉“')
  if (process.env.DEBUG_CONSOLE) { await B.page.waitForTimeout(6000); console.log('B dbg', await B.page.evaluate(() => JSON.stringify({ meta: JSON.parse(localStorage.getItem('ausgaben-app:sync')), n: JSON.parse(localStorage.getItem('ausgaben-app:v1')).transactions.length, badge: document.querySelector('.sync-badge')?.className, overlay: !!document.querySelector('.auth-overlay'), text: document.querySelector('.auth-overlay')?.innerText?.slice(0, 200) }))) }
  await B.page.waitForFunction(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')).transactions.some((t) => t.amountCents === 1990), null, { timeout: 20000 })
  const bSettings = (await data(B.page)).settings
  assert.equal(bSettings.lastPersonId, 'p2', 'B ist Person 2')
  log('B: sieht A’s bisherige Buchung (19,90 €), B ist als Person 2 voreingestellt')

  // --- Live: entry on A appears on B
  const t1 = Date.now()
  await addExpense(A.page, ['2', '3', ',', '4', '5'], 'Picnic')
  await B.page.waitForFunction(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')).transactions.some((t) => t.amountCents === 2345 && t.categoryId === 'picnic' && !t.deleted), null, { timeout: 30000 })
  log(`✓ Buchung von A (23,45 € Picnic) erscheint auf B nach ${((Date.now() - t1) / 1000).toFixed(1)} s`)
  await B.page.locator('.tabbar').getByText('Übersicht', { exact: true }).click()
  await B.page.getByText('23,45').first().waitFor()
  await B.page.screenshot({ path: 'screenshots/sync-b-uebersicht.png' })

  // --- and back: B → A, with B's payer = p2
  await addExpense(B.page, ['7', ',', '5', '0'], 'Lieferando')
  await A.page.waitForFunction(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')).transactions.some((t) => t.amountCents === 750 && t.personId === 'p2'), null, { timeout: 30000 })
  log('✓ Buchung von B (7,50 € Lieferando, Person 2) erscheint auf A')

  // --- delete on B propagates to A
  const tx2345 = (await liveTx(B.page)).find((t) => t.amountCents === 2345)
  await B.page.locator('.tabbar').getByText('Übersicht', { exact: true }).click()
  await B.page.locator('.tx-row', { hasText: '23,45' }).first().click()
  await B.page.getByLabel('Buchung löschen').click()
  await A.page.waitForFunction((id) => JSON.parse(localStorage.getItem('ausgaben-app:v1')).transactions.find((t) => t.id === id)?.deleted === true, tx2345.id, { timeout: 30000 })
  log('✓ Löschen auf B wird auf A übernommen')

  // --- offline on B, then back online
  await B.ctx.setOffline(true)
  await B.page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await addExpense(B.page, ['4', '2'], 'Dating')
  await B.page.locator('.sync-badge.off').waitFor({ timeout: 10000 })
  await B.page.screenshot({ path: 'screenshots/sync-offline.png' })
  await B.ctx.setOffline(false)
  await A.page.waitForFunction(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')).transactions.some((t) => t.amountCents === 4200 && !t.deleted), null, { timeout: 40000 })
  await B.page.locator('.sync-badge.ok').waitFor({ timeout: 20000 })
  log('✓ Offline auf B erfasst (Status „offline“), nach Wiederverbindung auf A angekommen')

  // --- recurring rule: generated on both devices, but exactly one row per month in the DB
  await A.page.locator('.tabbar').getByText('Planen', { exact: true }).click()
  await A.page.getByRole('radio', { name: /Fixkosten/ }).click()
  await A.page.getByText('Fixkosten / Einnahme hinzufügen').click()
  await A.page.getByPlaceholder('z. B. Miete').fill('Miete')
  await A.page.getByPlaceholder('0,00').fill('900')
  await A.page.locator('.sheet select').selectOption('1')
  await A.page.locator('.sheet').getByText('Speichern', { exact: true }).click()
  await B.page.waitForFunction(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')).recurring.some((r) => r.note === 'Miete' && r.amountCents === 90000), null, { timeout: 30000 })
  await B.page.reload() // B generates the booking locally, too (deterministic id)
  await B.page.waitForSelector('.tabbar')
  await B.page.waitForTimeout(4000)
  const rows = [{ n: await count('transactions', `household_id=eq.${householdId}&recurring_id=not.is.null&deleted=is.false`) }]
  const local = { A: (await liveTx(A.page)).filter((t) => t.recurringId).length, B: (await liveTx(B.page)).filter((t) => t.recurringId).length }
  assert.equal(rows[0].n, 1)
  assert.deepEqual(local, { A: 1, B: 1 })
  log('✓ Fixkosten: auf beiden Geräten genau 1 Buchung, in der Datenbank genau 1 Zeile')

  // --- interval rules (needs migration 0003 on the server; otherwise the picker is locked for synced households)
  {
    await A.page.getByText('Fixkosten / Einnahme hinzufügen').click()
    const locked = await A.page.locator('.sheet .interval-picker.locked').count()
    if (locked) {
      assert.ok(await A.page.getByText('nach dem nächsten Server-Update').isVisible())
      await A.page.getByText('Schließen').click()
      log('✓ Intervall-Auswahl gesperrt, solange Migration 0003 fehlt (verhindert Doppelbuchungen)')
    } else {
      await A.page.getByPlaceholder('z. B. Miete').fill('Versicherung')
      await A.page.getByPlaceholder('0,00').fill('1200')
      await A.page.locator('.sheet .interval-picker').getByRole('radio', { name: 'Jährlich' }).click()
      await A.page.locator('.sheet').getByText('Speichern', { exact: true }).click()
      await B.page.waitForFunction(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')).recurring.some((r) => r.note === 'Versicherung' && r.intervalMonths === 12), null, { timeout: 30000 })
      log('✓ Jährliche Fixbuchung inkl. Intervall auf B angekommen')
    }
  }

  // --- names (settings) sync
  await A.page.locator('.tabbar').getByText('Mehr', { exact: true }).click()
  await A.page.getByLabel('Name Person 1').fill('Max')
  await A.page.getByLabel('Name Person 1').blur()
  await B.page.waitForFunction(() => JSON.parse(localStorage.getItem('ausgaben-app:v1')).settings.persons[0].name === 'Max', null, { timeout: 30000 })
  log('✓ Namensänderung auf A erscheint auf B')

  // --- final consistency: both devices hold the same live transactions
  await A.page.waitForTimeout(3000)
  const ids = async (p) => (await liveTx(p)).map((t) => `${t.id}:${t.amountCents}`).sort()
  assert.deepEqual(await ids(A.page), await ids(B.page))
  const db = [{ n: await count('transactions', `household_id=eq.${householdId}&deleted=is.false`) }]
  assert.equal(db[0].n, (await ids(A.page)).length)
  log(`✓ A, B und Datenbank stimmen überein (${db[0].n} aktive Buchungen)`)

  await B.page.locator('.tabbar').getByText('Mehr', { exact: true }).click()
  await B.page.locator('.sync-card').scrollIntoViewIfNeeded()
  await B.page.screenshot({ path: 'screenshots/sync-mehr.png' })
  // sign out on B keeps local data
  await B.page.getByRole('button', { name: 'Abmelden' }).click()
  await B.page.locator('.sync-card').getByRole('button', { name: 'Anmelden mit E-Mail' }).waitFor()
  assert.ok((await liveTx(B.page)).length > 0)
  log('✓ Abmelden auf B (lokale Daten bleiben)')

  assert.deepEqual(errors.filter((e) => !/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/.test(e)), [])
  console.log('\nSync-E2E bestanden.')
} finally {
  await browser.close()
  // Cleanup: household (cascades to all data), users (cascade membership + hand-offs)
  try {
    const ids = Object.values(users).filter((u) => u.id).map((u) => u.id)
    if (householdId) await rest(`households?id=eq.${householdId}`, { method: 'DELETE' })
    if (ids.length) await rest(`households?created_by=in.(${ids.join(',')})`, { method: 'DELETE' })
    for (const id of ids) await admin(`/users/${id}`, { method: 'DELETE' }) // cascades memberships + login hand-offs
    const all = await admin('/users?per_page=200')
    const left = {
      testUsers: all.users.filter((u) => /^e2e-.*@example\.com$/.test(u.email)).length,
      testHousehold: householdId ? (await count('households', `id=eq.${householdId}`)) : 0,
      testTx: householdId ? (await count('transactions', `household_id=eq.${householdId}`)) : 0,
    }
    console.log('Aufgeräumt (nur Testdaten):', JSON.stringify(left))
  } catch (e) {
    console.error('Aufräumen fehlgeschlagen:', e.message)
    process.exitCode = 1
  }
}
