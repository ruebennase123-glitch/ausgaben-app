// Dark-mode screenshots: negative balance, category detail, search/filter (390x844 @3x, fictional seed data)
import { chromium } from 'playwright-core'
import { buildSeed } from './seed-data.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const seed = buildSeed()
delete seed._cm
seed.settings.theme = 'dark'
// a big one-off expense this month → negative balance
const now = new Date()
const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Math.min(now.getDate(), 28)).padStart(2, '0')}`
seed.transactions.push({ id: 'shot-neg', createdAt: now.toISOString(), updatedAt: now.toISOString(), type: 'expense', amountCents: 780000, categoryId: 'renovieren', personId: 'joint', note: 'Neue Küche', date: iso })

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'dark', serviceWorkers: 'block' })
await ctx.addInitScript((json) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem('ausgaben-app:v1', json)
    localStorage.setItem('ausgaben-app:onboarded', '1')
    sessionStorage.setItem('seeded', '1')
  }
}, JSON.stringify(seed))
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message))
await page.goto(BASE + '/#overview')
await page.waitForSelector('.balance-card.neg')
await page.waitForTimeout(600)
await page.screenshot({ path: OUT + 'saldo-negativ.png' })
await page.locator('.legend .legend-btn').nth(1).click()
await page.waitForSelector('.detail-page')
await page.waitForTimeout(600)
await page.screenshot({ path: OUT + 'kategorie-detail.png' })
await page.getByRole('button', { name: 'Zurück zur Übersicht' }).click()
await page.getByLabel('Buchungen durchsuchen').scrollIntoViewIfNeeded()
await page.getByRole('button', { name: /^Filter/ }).click()
await page.locator('.fchip[data-cat="lebensmittel"]').click()
await page.locator('.fchip[data-cat="lebensmittel"]').click()
await page.getByLabel('Buchungen durchsuchen').fill('e')
await page.getByLabel('Buchungen durchsuchen').blur()
await page.evaluate(() => document.querySelector('.search-row').scrollIntoView({ block: 'start' }))
await page.evaluate(() => window.scrollBy(0, -50))
await page.waitForTimeout(500)
await page.screenshot({ path: OUT + 'suche-filter.png' })
await browser.close()
console.log('ok')
