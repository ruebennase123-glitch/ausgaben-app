# Haushaltsbuch – Ausgaben zu zweit (PWA)

Mobile-first, installierbare Web-App (PWA) zum gemeinsamen Erfassen von Ausgaben/Einnahmen.
UI Deutsch, Währung EUR. Daten liegen immer zuerst lokal (localStorage, funktioniert offline) und werden – nach
Anmeldung und Verbindung zu einem gemeinsamen Haushalt – über **Supabase** zwischen beiden iPhones synchronisiert.

## Starten

```bash
npm install
npm run dev          # Entwicklung: http://localhost:5173 (auch im LAN erreichbar)
npm run build        # Typecheck + Produktions-Build nach dist/
npm run preview      # Produktions-Build lokal ausliefern: http://localhost:4173
npm run test:smoke   # E2E-Smoke-Test gegen laufendes preview (headless Chrome)
npm run test:sync    # Sync-E2E mit zwei Browser-Kontexten (braucht lokale Admin-Secrets, s. u.)
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
src/sync/*                Supabase-Sync: engine.ts (Auth, Haushalt, Push/Pull, Realtime), mapping.ts (Zeilen ↔ App-Daten, LWW-Merge),
                          AuthFlow.tsx (Willkommen/Anmeldung/Haushalt), SyncBadge.tsx, SyncSettings.tsx
supabase/migrations/*     Datenbankschema, RLS, RPCs (per Management-API angewendet)
pwa/sw.js                 Service-Worker-Vorlage (Precache-Liste wird beim Build eingesetzt, vite.config.ts)
```

Laufzeit-Abhängigkeiten: React und `@supabase/supabase-js`. Beträge werden als ganze Cent gespeichert.

## Sync zwischen zwei iPhones (Supabase, Free Plan)

- Projekt: `vjuengqneehjwhbiaxcj` (Region `eu-central-1`, Frankfurt), **Free Plan**.
- Im Frontend stehen nur Projekt-URL und der öffentliche *publishable key* (`src/sync/config.ts`, per
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` überschreibbar; `VITE_SYNC_DISABLED=1` schaltet Sync ab).
  Datenbank-Passwort und Secret-Key liegen nur lokal außerhalb des Repos.
- **Schema** (`supabase/migrations/0001_init.sql`): `households` (Einladungscode, Namen/Einstellungen als JSON),
  `household_members` (Slots `p1`/`p2`, max. 2 Personen), Datentabellen `transactions`, `recurring_rules`, `budgets`,
  `savings_goals`, `goal_contributions`, `checkins`, `badges` – jeweils `id uuid`, `household_id`, `updated_at`, `deleted`.
  **Row Level Security** auf allen Tabellen: nur Mitglieder des Haushalts lesen/schreiben; kein Zugriff für `anon`.
  Haushalt erstellen/beitreten nur über RPCs (`create_household`, `join_household`).
- **Sync-Verfahren (local-first)**: App arbeitet immer mit lokalen Daten. Bei Start, beim Zurückkehren in die App,
  nach jeder Änderung (1,2 s gebündelt), alle 45 s und per Realtime: erst *Pull* (alles seit letztem Abgleich, nach
  Server-Zeitstempel), dann *Push*. Konflikte: *last write wins* nach `updated_at` (Datenbank-Trigger ignoriert ältere
  Stände). Löschungen sind Tombstones. Fixkosten-Buchungen haben deterministische IDs (UUIDv5 aus Regel + Monat),
  daher bucht kein Monat doppelt, auch wenn beide iPhones sie erzeugen.
- **Erste Anmeldung**: vorhandene lokale Daten werden auf Wunsch **zusammengeführt** (nichts wird gelöscht; bei
  „nicht übernehmen“ bleibt eine Sicherung im Gerät). Wer beitritt, wird Person 2; seine bisherigen „Ich“-Einträge
  können automatisch Person 2 zugeordnet werden.
- **Anmeldung ohne Passwort** per E-Mail-Link. Auf dem iPhone öffnet der Link Safari, die installierte App ist aber
  ein eigener Speicherbereich. Deshalb erzeugt die App beim Anfordern ein zufälliges Einmal-Geheimnis (im Link);
  die Safari-Seite übergibt die Anmeldung (Geheimnis nur als Hash gespeichert, 15 Minuten gültig, einmalig abrufbar) und die App holt sie
  automatisch ab. Ein 6-stelliger Code ist als Alternative eingebaut, erscheint aber nur in der E-Mail, wenn eigene
  E-Mail-Vorlagen aktiv sind (s. Grenzen).
- Erlaubte Weiterleitungen: `https://ruebennase123-glitch.github.io/ausgaben-app/**`, `http://localhost:5173/**`,
  `http://localhost:4173/**` (`supabase/auth-config.json`).

### So richtet ihr es auf euren iPhones ein

1. Beide: https://ruebennase123-glitch.github.io/ausgaben-app/ in **Safari** öffnen → Teilen → „Zum Home-Bildschirm“.
   App vom Home-Bildschirm starten.
2. **Person 1**: „Anmelden mit E-Mail“ → E-Mail eingeben → „Anmeldelink senden“. In der Mail-App auf den Link
   tippen (Mail ist auf Englisch, Absender „Supabase Auth“, ggf. im Spam-Ordner nachsehen). Safari zeigt
   „Angemeldet!“ → zurück zur Haushaltsbuch-App, sie meldet sich automatisch an.
3. Person 1: „Haushalt erstellen“ → den angezeigten **Einladungscode** (6 Zeichen) per „Code teilen“ schicken.
4. **Person 2**: genauso anmelden (eigene E-Mail-Adresse) → „Mit Code beitreten“ → Code eingeben.
5. Fertig. Der Wolken-Status oben rechts zeigt ✓ (synchron), ⨯ (offline, wird später nachgeholt) oder einen Kreis
   (synchronisiert gerade). Unter „Mehr → Gemeinsam synchronisieren“: Status, Code, „Jetzt synchronisieren“, „Abmelden“.

### Grenzen des Free Plans

- **E-Mail-Limit**: Der eingebaute Supabase-Mailversand erlaubt nur **2 Anmelde-Mails pro Stunde** (projektweit) und
  ist nicht für Produktion gedacht. Also nicht mehrfach hintereinander „senden“ tippen. Man bleibt angemeldet, nur die
  erste Anmeldung pro Gerät braucht eine Mail.
- **E-Mail-Vorlagen** (Deutsch, mit 6-stelligem Code `{{ .Token }}`) lassen sich im Free Plan mit dem Standard-Mailversand
  nicht ändern. Vorbereitet in `supabase/email-templates.custom-smtp-only.json`; aktivierbar nach Einrichten eines eigenen
  (kostenlosen) SMTP-Anbieters unter Authentication → SMTP, danach Vorlagen per Management-API `PATCH /config/auth` setzen.
- **Pausieren**: Free-Projekte werden nach ca. **7 Tagen ohne Aktivität pausiert**. Die App funktioniert dann weiter
  offline/lokal; im Supabase-Dashboard „Restore project“ klicken, danach gleicht sie alles nach. Regelmäßige Nutzung
  verhindert das.
- 500 MB Datenbank, 2 aktive Projekte pro Organisation – für ein Haushaltsbuch weit mehr als genug.

### Tests

- `npm run test:smoke`: App ohne Konto, Onboarding, offline.
- `npm run test:sync` (lokal oder `BASE_URL=https://ruebennase123-glitch.github.io/ausgaben-app`): zwei getrennte
  Browser-Kontexte; A meldet sich an (Link wird über die Admin-API erzeugt, keine echten Mails), erstellt den Haushalt,
  B tritt per Code bei; geprüft werden Buchungen in beide Richtungen, Löschen, Offline/Online, Fixkosten ohne Doppelung,
  Namen, Abmelden. Testnutzer und Testhaushalt werden danach gelöscht. Benötigt `SUPABASE_ACCESS_TOKEN` und
  `/home/box/.config/ausgaben-app/secrets.env` (`SECRETS_FILE`), beides nicht im Repo.
