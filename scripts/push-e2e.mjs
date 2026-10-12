// End-to-end Web Push test: a temporary test user + household, headless Chrome (persistent profile, push needs it),
// "Aktivieren" in Mehr → Benachrichtigungen, test push via the deployed Edge Function, scoped budget dispatch.
// Secrets are read at runtime from a local file outside the repo and never logged. All test data is deleted afterwards.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const BASE = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '')
const SHOT = process.env.SHOT || ''
const readEnv = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const env = readEnv(process.env.SECRETS_FILE || '/home/box/.config/ausgaben-app/secrets.env')
const pub = readEnv(process.env.PUBLIC_FILE || '/home/box/.config/ausgaben-app/public.env')
const REF = env.SUPABASE_PROJECT_REF
const API = `https://${REF}.supabase.co`
const SECRET = env.SUPABASE_SECRET_KEY
const ANON = pub.VITE_SUPABASE_PUBLISHABLE_KEY
assert.ok(REF && SECRET && ANON && env.PUSH_CRON_SECRET, 'Konfiguration fehlt')
const t0 = Date.now()
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`)

const req = async (url, init, label) => {
  const r = await fetch(url, init)
  const t = await r.text()
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${t.slice(0, 120)}`)
  return t ? JSON.parse(t) : null
}
const svc = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }
const rest = (path, init = {}) => req(`${API}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers || {}) } }, `rest ${path.split('?')[0]}`)

const email = `push-e2e-${Math.random().toString(36).slice(2, 8)}@example.com`
const password = randomUUID()
let userId, householdId, ctx, profile
try {
  const u = await req(`${API}/auth/v1/admin/users`, { method: 'POST', headers: svc, body: JSON.stringify({ email, password, email_confirm: true }) }, 'create user')
  userId = u.id
  const session = await req(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }, 'login')
  const user = { apikey: ANON, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
  const hh = await req(`${API}/rest/v1/rpc/create_household`, { method: 'POST', headers: user, body: JSON.stringify({ p_settings: {}, p_settings_updated_at: new Date().toISOString() }) }, 'create household')
  householdId = hh[0].id
  log('Testnutzer + Haushalt angelegt')

  profile = mkdtempSync(join(tmpdir(), 'push-e2e-'))
  ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: 'dark', args: ['--lang=de-DE'] })
  await ctx.grantPermissions(['notifications'], { origin: new URL(BASE).origin })
  await ctx.addInitScript(([s]) => {
    if (!localStorage.getItem('ausgaben-app:auth')) localStorage.setItem('ausgaben-app:auth', s)
    localStorage.setItem('ausgaben-app:onboarded', '1')
  }, [JSON.stringify(session)])
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE}/#settings`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.evaluate(() => { window.__push = []; navigator.serviceWorker.addEventListener('message', (e) => window.__push.push(e.data)) })
  // fresh device → the app links to the (empty) test household automatically; close the sync dialog if it stays open
  const overlay = page.locator('.auth-overlay')
  await page.locator('.sync-card').getByText('Synchronisiert').waitFor({ timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(1000)
  await overlay.waitFor({ state: 'detached', timeout: 15000 }).catch(async () => {
    log(`Dialog: ${(await overlay.innerText()).slice(0, 80).replace(/\n/g, ' | ')}`)
    await overlay.locator('.text-btn').first().click()
    await overlay.waitFor({ state: 'detached', timeout: 10000 })
  })
  const card = page.getByTestId('push-settings')
  await card.getByRole('button', { name: /Aktivieren/ }).click()
  await card.getByText('Benachrichtigungen sind aktiv').waitFor({ timeout: 30000 })
  const subs = await rest(`push_subscriptions?select=endpoint,last_success_at&user_id=eq.${userId}`)
  assert.equal(subs.length, 1, 'Subscription gespeichert')
  log('Aktivieren → Subscription per RPC registriert')

  // toggles write notification_prefs (RLS: own row only)
  await card.getByRole('checkbox', { name: 'Partner hat etwas eingetragen' }).check()
  await card.getByLabel('Uhrzeit Abend-Erinnerung').fill('21:15')
  await page.waitForTimeout(1500)
  const [prefs] = await rest(`notification_prefs?select=partner_enabled,evening_time&user_id=eq.${userId}`)
  assert.equal(prefs.partner_enabled, true)
  assert.equal(String(prefs.evening_time).slice(0, 5), '21:15')
  await card.getByRole('checkbox', { name: 'Partner hat etwas eingetragen' }).uncheck()
  await card.getByLabel('Uhrzeit Abend-Erinnerung').fill('20:30')
  await page.waitForTimeout(1500)
  log('Schalter + Uhrzeit gespeichert')
  if (SHOT) {
    await card.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      document.activeElement?.blur()
      const h = document.querySelector('[data-testid="push-settings"]').previousElementSibling
      window.scrollBy(0, h.getBoundingClientRect().top - 70)
    })
    await page.waitForTimeout(300)
    await page.screenshot({ path: SHOT })
    log(`Screenshot: ${SHOT}`)
  }

  // 1) test push through the deployed Edge Function (user JWT)
  await card.getByRole('button', { name: 'Testbenachrichtigung senden' }).click()
  await card.getByText('Testbenachrichtigung gesendet').waitFor({ timeout: 30000 })
  log('Edge Function hat Test-Push an FCM übergeben – warte auf Zustellung (kann hier ~3 min dauern)')
  await page.waitForFunction(() => window.__push.some((m) => m.type === 'push' && m.msg?.tag === 'test'), null, { timeout: 300000 })
  log('Test-Push im Service Worker empfangen ✓')

  // 2) budget warning via scoped dispatch (only this test user)
  const now = new Date()
  const month = now.toISOString().slice(0, 7)
  await rest('budgets', { method: 'POST', body: JSON.stringify({ household_id: householdId, category_id: 'restaurant', limit_cents: 10000, updated_at: now.toISOString() }) })
  await rest('transactions', { method: 'POST', body: JSON.stringify({ id: randomUUID(), household_id: householdId, type: 'expense', amount_cents: 8500, category_id: 'restaurant', person_id: 'p1', note: 'e2e', date: `${month}-01` > now.toISOString().slice(0, 10) ? now.toISOString().slice(0, 10) : now.toISOString().slice(0, 10), created_at: now.toISOString(), updated_at: now.toISOString(), created_by: userId }) })
  const stats = await req(`${API}/functions/v1/push-dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.PUSH_CRON_SECRET }, body: JSON.stringify({ action: 'dispatch', now: now.toISOString(), user_ids: [userId] }) }, 'dispatch')
  log(`Dispatch: ${JSON.stringify(stats)}`)
  const marks = await rest(`budget_alerts_sent?select=level&household_id=eq.${householdId}`)
  assert.deepEqual(marks.map((m) => m.level), [80], '80-%-Warnung vermerkt (genau einmal)')
  await page.waitForFunction(() => window.__push.some((m) => m.msg?.tag === 'budget-restaurant'), null, { timeout: 300000 })
  log('Budget-Warnung (80 %) empfangen ✓')
  const again = await req(`${API}/functions/v1/push-dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.PUSH_CRON_SECRET }, body: JSON.stringify({ action: 'dispatch', now: now.toISOString(), user_ids: [userId] }) }, 'dispatch 2')
  assert.equal(again.sent, 0, 'keine doppelte Warnung')
  const [s2] = await rest(`push_subscriptions?select=last_success_at&user_id=eq.${userId}`)
  assert.ok(s2.last_success_at, 'last_success_at gesetzt')

  // 3) notification target URL (./#plan) switches the tab
  await page.evaluate(() => { location.hash = '#plan' })
  await page.locator('.tabbar .active').getByText('Planen').waitFor({ timeout: 5000 })

  // 4) deactivate
  await page.goto(`${BASE}/#settings`)
  await page.getByTestId('push-settings').getByRole('button', { name: /deaktivieren/ }).click()
  await page.getByText('deaktiviert').waitFor()
  assert.equal((await rest(`push_subscriptions?select=endpoint&user_id=eq.${userId}`)).length, 0, 'Subscription gelöscht')
  log('Deaktivieren löscht die Subscription ✓')
  assert.deepEqual(errors, [])
  console.log('PUSH E2E OK')
} finally {
  await ctx?.close().catch(() => {})
  if (profile) rmSync(profile, { recursive: true, force: true })
  if (householdId) await rest(`households?id=eq.${householdId}`, { method: 'DELETE' }).catch((e) => console.error('cleanup household', e.message))
  if (userId) await req(`${API}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: svc }, 'delete user').catch((e) => console.error('cleanup user', e.message))
  if (userId) {
    const left = (await rest(`push_subscriptions?select=user_id&user_id=eq.${userId}`)).length + (await rest(`notification_prefs?select=user_id&user_id=eq.${userId}`)).length + (await rest(`household_members?select=user_id&user_id=eq.${userId}`)).length
    log(`Aufräumen: Testnutzer + Haushalt gelöscht, Restzeilen: ${left}`)
  }
}
