# Haushaltsbuch – Ausgaben zu zweit (PWA-Prototyp v1)

Mobile-first, installierbare Web-App (PWA) zum gemeinsamen Erfassen von Ausgaben/Einnahmen.
UI Deutsch, Währung EUR. Daten liegen in v1 **nur lokal** (localStorage) auf dem jeweiligen Gerät.

## Starten

```bash
npm install
npm run dev          # Entwicklung: http://localhost:5173 (auch im LAN erreichbar)
npm run build        # Typecheck + Produktions-Build nach dist/
npm run preview      # Produktions-Build lokal ausliefern: http://localhost:4173
npm run test:smoke   # E2E-Smoke-Test gegen laufendes preview (headless Chrome)
npm run screenshots  # iPhone-Screenshots (390x844 @3x) nach screenshots/ – mit Beispieldaten
npm run icons        # PNG-Icons aus pwa/icon.svg neu erzeugen
```

Headless-Skripte nutzen `playwright-core` mit dem installierten Chrome (`CHROME_PATH`, Standard `/usr/bin/google-chrome`).
Beispieldaten (`scripts/seed-data.mjs`) werden nur für Screenshots in den Test-Browser injiziert; die App selbst startet leer.

> Service Worker & „Zum Home-Bildschirm“ funktionieren nur über **HTTPS** (oder localhost).
> Zum Testen auf dem iPhone daher ein HTTPS-Hosting (s. u.) oder einen HTTPS-Tunnel nutzen.

## Live / Deployment

- Live: https://ruebennase123-glitch.github.io/ausgaben-app/
- Jeder Push auf `main` baut und deployt automatisch per GitHub Actions (`.github/workflows/deploy.yml`, `BASE_PATH=/ausgaben-app/`).
- Lokal unter dem Unterpfad testen: `BASE_PATH=/ausgaben-app/ npm run build && BASE_PATH=/ausgaben-app/ npm run preview`
- Live prüfen: `npm run verify:live` (Seite, Manifest, Icons, Service Worker, Offline-Start)

## Funktionen

- **Wer zahlt?** Überall wählbar: Person 1, Person 2 oder **Gemeinsam** (Gemeinschaftskonto, Name/Emoji in den Einstellungen änderbar). Gemeinsam-Buchungen zählen für die gemeinsame Serie, nicht für die persönlichen.
- **Erfassen** (Startbildschirm): großer Ziffernblock, Ausgabe/Einnahme, Kategorie-Chips mit Emoji, Person/Gemeinsam, Datum (Standard heute), Notiz. Toast mit „Rückgängig“ und Budget-Warnung direkt nach dem Speichern.
- **Übersicht**: Monatssaldo, Einnahmen/Ausgaben, Donut-Diagramm nach Kategorie, Budget-Warnungen, Wochenrückblick, Buchungsliste nach Tagen (antippen = bearbeiten/löschen), Monatswechsler, Filter pro Person.
- **Planen**: Monatsbudgets pro Kategorie mit Fortschrittsbalken (grün/gelb ab 80 %/rot über 100 %), Gesamtbudget mit „Heute“-Marker; Fixkosten & regelmäßige Einnahmen (monatlich, Tag wählbar, pausierbar), die automatisch gebucht werden (idempotent, auch nach Löschen kein Doppel-Eintrag).
- **Erfolge**: gemeinsame & persönliche Tages-Serie (inkl. „Heute nichts ausgegeben“-Check-in), 14-Tage-Kalender, Wochenrückblick, gemeinsame Sparziele mit Einzahlungen pro Person, 11 Abzeichen mit Konfetti-Animation.
- **Mehr**: Namen/Emoji der beiden Personen, Hell/Dunkel/Auto, JSON-Backup exportieren (iPhone: Teilen-Menü → „In Dateien sichern“) und importieren, alles löschen, Installationsanleitung.
- PWA: Manifest, Icons (inkl. maskable & apple-touch-icon), Service Worker mit Precache (offline-fähig), `standalone`, Safe-Area-Insets, Dark Mode.

## Architektur

```
src/types.ts              Datenmodell (alle Datensätze: id, createdAt, updatedAt, deleted)
src/data/repository.ts    DataRepository-Interface + LocalStorageRepository
src/data/store.ts         App-Store (useSyncExternalStore), alle Mutationen, Badges/Fixkosten nach jedem Commit
src/logic/*               reine Funktionen: Statistik, Serien, Abzeichen, Fixkosten, Geld/Datum
src/screens/*             Bildschirme; src/components/* UI-Bausteine
pwa/sw.js                 Service-Worker-Vorlage (Precache-Liste wird beim Build eingesetzt, vite.config.ts)
```

Keine Laufzeit-Abhängigkeiten außer React. Beträge werden als ganze Cent gespeichert.

## Sync später ergänzen (z. B. Supabase)

Das Datenmodell ist bereits sync-tauglich: UUIDs, `updatedAt` je Datensatz, Löschungen als Tombstones (`deleted: true`).
Vorgehen: Tabellen `transactions`, `recurring`, `goals`, `checkins`, `budgets`, `settings` mit `household_id`;
eine `SyncRepository`-Implementierung lädt zuerst lokal (sofortiger Start/offline), pusht lokale Änderungen
mit `updatedAt > lastSync` und holt Remote-Änderungen; Merge pro Datensatz „last write wins“.
Fixkosten-Generierung dann serverseitig (oder mit deterministischer ID `ruleId+Monat`), damit zwei Geräte nicht doppelt buchen.
