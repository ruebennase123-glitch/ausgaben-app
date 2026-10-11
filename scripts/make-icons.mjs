// Renders pwa/icon.svg into the PNG icons in public/ using headless Chrome.
import { chromium } from 'playwright-core'
import { readFileSync, copyFileSync } from 'node:fs'

const svg = readFileSync(new URL('../pwa/icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' })
const page = await browser.newPage()
const out = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.12], // extra padding to stay in the maskable safe zone
  ['apple-touch-icon.png', 180, 0],
  ['favicon-32.png', 32, 0],
]
for (const [name, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size })
  const inner = size * (1 - pad * 2)
  await page.setContent(`<html><body style="margin:0;background:#6a5ae0;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`)
  await page.waitForTimeout(100)
  await page.screenshot({ path: `public/${name}`, omitBackground: false })
  console.log('wrote', name)
}
await browser.close()
copyFileSync(new URL('../pwa/icon.svg', import.meta.url), new URL('../public/favicon.svg', import.meta.url))
