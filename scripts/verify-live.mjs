// Verifies a deployed build: page loads, manifest + icons OK, service worker active, offline start.
// Usage: BASE_URL=https://ruebennase123-glitch.github.io/ausgaben-app node scripts/verify-live.mjs
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const BASE = (process.env.BASE_URL || 'https://ruebennase123-glitch.github.io/ausgaben-app').replace(/\/$/, '')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE' })
const page = await ctx.newPage()
const problems = []
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()))
page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`))

const res = await page.goto(BASE + '/', { waitUntil: 'networkidle' })
assert.equal(res.status(), 200)
await page.waitForSelector('.keypad')
console.log('✓ Seite lädt:', await page.title())

const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href')
const manifestUrl = new URL(manifestHref, page.url()).href
const mRes = await page.request.get(manifestUrl)
assert.equal(mRes.status(), 200)
const m = await mRes.json()
const scope = new URL(m.scope, manifestUrl).href
const start = new URL(m.start_url, manifestUrl).href
assert.equal(scope, BASE + '/')
assert.ok(start.startsWith(scope), 'start_url innerhalb scope')
assert.equal(m.display, 'standalone')
console.log(`✓ Manifest ${manifestUrl}\n  scope=${scope}\n  start_url=${start}`)

const iconUrls = [...m.icons.map((i) => new URL(i.src, manifestUrl).href)]
for (const sel of ['link[rel=apple-touch-icon]', 'link[rel=icon][type="image/svg+xml"]', 'link[rel=icon][type="image/png"]']) {
  iconUrls.push(new URL(await page.locator(sel).getAttribute('href'), page.url()).href)
}
for (const u of iconUrls) {
  const r = await page.request.get(u)
  assert.equal(r.status(), 200, u)
  assert.match(r.headers()['content-type'], /image/, u)
}
console.log(`✓ ${iconUrls.length} Icons laden (200, image/*)`)

const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready
  return { scope: reg.scope, script: reg.active?.scriptURL, state: reg.active?.state }
})
assert.equal(sw.scope, BASE + '/')
assert.equal(sw.state, 'activated')
console.log(`✓ Service Worker aktiv: ${sw.script} (scope ${sw.scope})`)

await page.reload({ waitUntil: 'networkidle' })
assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Seite wird vom SW kontrolliert')
await ctx.setOffline(true)
await page.reload()
await page.waitForSelector('.keypad')
console.log('✓ Startet offline aus dem Cache')
await ctx.setOffline(false)

await page.screenshot({ path: 'screenshots/live-github-pages.png' })
assert.deepEqual(problems, [], problems.join('\n'))
console.log('✓ Keine Konsolen-/Netzwerkfehler')
await browser.close()
