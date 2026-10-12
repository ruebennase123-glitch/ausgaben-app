// Takes iPhone-sized screenshots (390x844 @3x) of the production build.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { buildSeed } from './seed-data.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:4173'
const OUT = new URL('../screenshots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const seed = buildSeed()
delete seed._cm

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })

async function newPage({ dark = false, data = seed } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    colorScheme: dark ? 'dark' : 'light',
    serviceWorkers: 'block',
  })
  const d = structuredClone(data)
  d.settings.theme = dark ? 'dark' : 'light'
  await ctx.addInitScript((json) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('ausgaben-app:v1', json)
      sessionStorage.setItem('seeded', '1')
    }
  }, JSON.stringify(d))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('PAGE ERROR', e.message))
  return { ctx, page }
}

async function shot(page, name, opts = {}) {
  await page.waitForTimeout(500)
  // Fixed tab bar would be painted mid-page in full-page captures -> hide it there
  const style = opts.fullPage ? await page.addStyleTag({ content: '.tabbar{display:none!important}' }) : null
  await page.screenshot({ path: OUT + name, ...opts })
  if (style) await style.evaluate((el) => el.remove())
  console.log('saved', OUT + name)
}

async function tab(page, label) {
  await page.locator('.tabbar').getByText(label, { exact: true }).click()
  await page.waitForTimeout(250)
}

{
  const { ctx, page } = await newPage()
  await page.goto(BASE + '/#entry')
  await page.waitForSelector('.keypad')
  await shot(page, '01-erfassen-leer.png')
  for (const k of ['2', '4', ',', '9', '0']) await page.getByRole('button', { name: k, exact: true }).click()
  await page.getByRole('radio', { name: /Lebensmittel/ }).click()
  await page.fill('.note-input', 'Wochenmarkt')
  await shot(page, '02-erfassen-ausgefuellt.png')

  await tab(page, 'Übersicht')
  await shot(page, '03-uebersicht.png')
  await shot(page, '03b-uebersicht-ganze-seite.png', { fullPage: true })
  await page.locator('.tx-row').first().click()
  await shot(page, '04-buchung-bearbeiten.png')
  await page.getByText('Schließen').click()

  await tab(page, 'Planen')
  await shot(page, '05-budgets.png')
  await shot(page, '05b-budgets-ganze-seite.png', { fullPage: true })
  await page.getByRole('radio', { name: /Fixkosten/ }).click()
  await shot(page, '06-fixkosten.png')

  await tab(page, 'Erfolge')
  await shot(page, '07-erfolge.png')
  await shot(page, '07b-erfolge-ganze-seite.png', { fullPage: true })

  await tab(page, 'Mehr')
  await shot(page, '09-einstellungen.png')
  await ctx.close()
}

// Badge celebration: remove one earned badge so it is "newly" earned on load
{
  const data = structuredClone(seed)
  delete data.badges.streak_7
  const { ctx, page } = await newPage({ data })
  await page.goto(BASE + '/#goals')
  await page.waitForSelector('.celebrate-card')
  await page.waitForTimeout(900)
  await shot(page, '08-abzeichen-animation.png')
  await ctx.close()
}

// Dark mode
{
  const { ctx, page } = await newPage({ dark: true })
  await page.goto(BASE + '/#overview')
  await page.waitForSelector('.balance-card')
  await shot(page, '10-dunkel-uebersicht.png')
  await tab(page, 'Erfassen')
  await shot(page, '11-dunkel-erfassen.png')
  for (const k of ['6', '4', ',', '9', '0']) await page.getByRole('button', { name: k, exact: true }).click()
  await page.getByRole('radio', { name: /Renovieren/ }).click()
  await page.locator('.segmented').getByRole('radio', { name: /Gemeinsam/ }).click()
  await page.fill('.note-input', 'Farbe Baumarkt')
  await shot(page, 'neue-kategorien.png')
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Letzte Ziffer löschen' }).click()
  await tab(page, 'Erfolge')
  await shot(page, '12-dunkel-erfolge.png')
  await tab(page, 'Planen')
  await page.getByRole('radio', { name: /Fixkosten/ }).click()
  await page.locator('.tx-row', { hasText: 'Warmmiete' }).click()
  await page.waitForSelector('.sheet')
  await shot(page, 'gemeinsam-fixkosten.png')
  await ctx.close()
}

await browser.close()
