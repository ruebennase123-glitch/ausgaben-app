import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'

/** Emits sw.js with the list of all built files so the app works fully offline. */
function serviceWorker(): Plugin {
  return {
    name: 'haushaltsbuch-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      // Paths are relative to the SW location, so the app works under any base path (e.g. GitHub Pages /ausgaben-app/).
      const files = new Set<string>(['./', 'index.html'])
      for (const f of Object.keys(bundle)) if (!f.endsWith('.map')) files.add(f)
      for (const f of readdirSync('public')) files.add(f)
      const src = readFileSync('pwa/sw.js', 'utf8')
        .replace('__VERSION__', Date.now().toString(36))
        .replace('__PRECACHE__', JSON.stringify([...files], null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src })
    },
  }
}

// Base path: '/' locally, '/ausgaben-app/' on GitHub Pages (set via BASE_PATH in the deploy workflow).
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [react(), serviceWorker()],
  server: { host: true },
  preview: { host: true, port: 4173 },
})
