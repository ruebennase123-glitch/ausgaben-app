// Local-first sync engine: localStorage stays the source for the UI; changes are pushed to
// Supabase and remote changes pulled (cursor = server_updated_at), merged last-write-wins.
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { SUPABASE_KEY, SUPABASE_URL, SYNC_ENABLED } from './config'
import { store } from '../data/store'
import { emptyData } from '../data/defaults'
import type { AppData, MemberId } from '../types'
import {
  badgeRow, budgetRow, checkinRow, contribRow, ensureUuids, goalRow, localRecordCount, mergeRemote, ruleRow, swapPersons, ts, txRow,
  type RemoteBatch, type Row, type Versions,
} from './mapping'
import { isUuid } from '../logic/uuid5'

const META_KEY = 'ausgaben-app:sync'
const PENDING_KEY = 'ausgaben-app:pending-login'
const BACKUP_KEY = 'ausgaben-app:v1:backup-before-sync'
const AUTH_KEY = 'ausgaben-app:auth'
const PENDING_TTL = 15 * 60 * 1000
const TABLES = ['recurring_rules', 'savings_goals', 'goal_contributions', 'transactions', 'budgets', 'checkins', 'badges'] as const
type Table = (typeof TABLES)[number]

// Captured before the app rewrites the URL hash
const initialUrl = typeof location !== 'undefined' ? location.href : ''

export interface HouseholdInfo {
  id: string
  inviteCode: string
  slot: MemberId
  memberCount: number
  settings: RemoteBatch['household']
}
export type Phase = 'disabled' | 'loading' | 'signed-out' | 'no-household' | 'needs-link' | 'ready' | 'handoff'
export interface SyncState {
  phase: Phase
  net: 'idle' | 'syncing' | 'offline' | 'error'
  email?: string
  userId?: string
  household?: HouseholdInfo
  lastSyncAt?: string
  error?: string
  pending?: { email: string; since: number }
  handoff?: 'done' | 'error'
  /** The linked household disappeared (e.g. removed) – show the create/join choice again. */
  householdGone?: boolean
}
interface Meta {
  userId: string
  householdId: string
  slot: MemberId
  inviteCode: string
  cursors: Partial<Record<Table | 'households', string>>
  versions: Versions
}
interface Pending { email: string; secret: string; since: number }

const readJSON = <T,>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null
  } catch {
    return null
  }
}
const isNetworkError = (e: unknown) =>
  !navigator.onLine || /fetch|network|Load failed|NetworkError/i.test(String((e as Error)?.message ?? e))

export function germanAuthError(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e)
  const code = String((e as { code?: string })?.code ?? '')
  const status = (e as { status?: number })?.status
  if (/rate limit|over_email_send_rate_limit/i.test(msg + code) || status === 429)
    return 'Zu viele E-Mails in kurzer Zeit. Bitte etwas warten (max. 2 Anmelde-E-Mails pro Stunde) und dann erneut versuchen.'
  if (/invalid_code/.test(msg)) return 'Diesen Einladungscode gibt es nicht. Bitte prüfen.'
  if (/household_full/.test(msg)) return 'Dieser Haushalt hat schon zwei Mitglieder.'
  if (/already_member/.test(msg)) return 'Du bist bereits Mitglied eines Haushalts.'
  if (/household_shared/.test(msg)) return 'Euer jetziger Haushalt hat schon zwei Mitglieder – ein Wechsel ist dann nicht möglich.'
  if (/switch_household|PGRST202|Could not find the function/.test(msg)) return 'Der Wechsel ist auf dem Server noch nicht freigeschaltet. Bitte später erneut versuchen.'
  if (/expired|invalid/i.test(msg) && /otp|token/i.test(msg)) return 'Der Code ist falsch oder abgelaufen.'
  if (/email/i.test(msg) && /invalid/i.test(msg)) return 'Bitte eine gültige E-Mail-Adresse eingeben.'
  if (isNetworkError(e)) return 'Keine Internetverbindung.'
  return 'Das hat nicht geklappt: ' + msg
}

class SyncEngine {
  state: SyncState = { phase: SYNC_ENABLED ? 'loading' : 'disabled', net: 'idle' }
  private listeners = new Set<() => void>()
  private client: SupabaseClient | null = null
  private channel: RealtimeChannel | null = null
  private running = false
  private rerun = false
  private timers: Record<string, number | undefined> = {}
  private pollTimer: number | undefined
  private started = false

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.state
  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  private get meta(): Meta | null {
    return readJSON<Meta>(META_KEY)
  }
  private saveMeta(m: Meta | null) {
    if (m) localStorage.setItem(META_KEY, JSON.stringify(m))
    else localStorage.removeItem(META_KEY)
  }
  get sb(): SupabaseClient {
    if (!this.client) throw new Error('sync disabled')
    return this.client
  }

  async init() {
    if (!SYNC_ENABLED || this.started) return
    this.started = true
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: 'implicit', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: AUTH_KEY },
    })
    if (await this.handleRedirect()) return

    this.client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') this.onSignedOut()
      else if (session && event === 'TOKEN_REFRESHED') this.set({ email: session.user.email ?? this.state.email })
    })
    const { data } = await this.client.auth.getSession()
    if (data.session) await this.afterSignIn()
    else {
      this.set({ phase: 'signed-out' })
      this.resumePending()
    }

    store.onCommit((source) => source === 'local' && this.schedule('local', 1200))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      if (this.state.phase === 'ready') this.syncNow()
      if (this.state.pending) this.pollOnce()
    })
    window.addEventListener('online', () => this.syncNow())
    window.addEventListener('offline', () => this.state.phase === 'ready' && this.set({ net: 'offline' }))
    window.setInterval(() => document.visibilityState === 'visible' && this.syncNow(), 45_000)
  }

  /** Magic-link redirect: either finish a hand-off for the installed app, or sign in this browser. */
  private async handleRedirect(): Promise<boolean> {
    const url = new URL(initialUrl)
    const hash = new URLSearchParams(url.hash.slice(1))
    const pair = url.searchParams.get('pair')
    if (hash.get('error_description')) {
      this.set({ error: 'Der Anmeldelink ist ungültig oder abgelaufen. Bitte neu anfordern.' })
      if (pair) history.replaceState(null, '', url.pathname + '#entry')
      return false
    }
    const access = hash.get('access_token')
    const refresh = hash.get('refresh_token')
    if (!access || !refresh) return false
    history.replaceState(null, '', url.pathname + '#entry')
    const pending = readJSON<Pending>(PENDING_KEY)
    if (pair && pending?.secret !== pair) {
      // Opened in Safari while the login was started in the home-screen app: hand the session over.
      this.set({ phase: 'handoff' })
      try {
        const tmp = createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { headers: { Authorization: `Bearer ${access}` } },
        })
        const { error } = await tmp.rpc('store_login_handoff', { p_secret: pair, p_refresh_token: refresh })
        if (error) throw error
        this.set({ handoff: 'done' })
      } catch (e) {
        console.error(e)
        this.set({ handoff: 'error', error: germanAuthError(e) })
      }
      return true
    }
    await this.sb.auth.setSession({ access_token: access, refresh_token: refresh })
    localStorage.removeItem(PENDING_KEY)
    return false
  }

  // ---------- Login ----------
  async requestLogin(email: string) {
    const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const redirect = `${location.origin}${import.meta.env.BASE_URL}?pair=${secret}`
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } })
    if (error) throw error
    const p: Pending = { email, secret, since: Date.now() }
    localStorage.setItem(PENDING_KEY, JSON.stringify(p))
    this.set({ pending: { email, since: p.since }, error: undefined })
    this.startPolling()
  }
  cancelLogin() {
    localStorage.removeItem(PENDING_KEY)
    window.clearInterval(this.pollTimer)
    this.set({ pending: undefined })
  }
  private resumePending() {
    const p = readJSON<Pending>(PENDING_KEY)
    if (!p) return
    if (Date.now() - p.since > PENDING_TTL) return this.cancelLogin()
    this.set({ pending: { email: p.email, since: p.since } })
    this.startPolling()
  }
  private startPolling() {
    window.clearInterval(this.pollTimer)
    this.pollTimer = window.setInterval(() => this.pollOnce(), 2500)
    this.pollOnce()
  }
  private async pollOnce() {
    const p = readJSON<Pending>(PENDING_KEY)
    if (!p || this.state.phase !== 'signed-out') return window.clearInterval(this.pollTimer)
    if (Date.now() - p.since > PENDING_TTL) {
      this.cancelLogin()
      return this.set({ error: 'Der Anmeldelink ist abgelaufen. Bitte neu anfordern.' })
    }
    const { data, error } = await this.sb.rpc('claim_login_handoff', { p_secret: p.secret })
    if (error || !data) return
    const { error: e2 } = await this.sb.auth.refreshSession({ refresh_token: data as string })
    if (e2) return this.set({ error: germanAuthError(e2) })
    this.cancelLogin()
    await this.afterSignIn()
  }
  /** Optional: 6-digit code (only present in the email when custom email templates are configured). */
  async verifyCode(email: string, code: string) {
    const { error } = await this.sb.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    if (error) throw error
    this.cancelLogin()
    await this.afterSignIn()
  }

  private async afterSignIn() {
    const { data } = await this.sb.auth.getSession()
    const user = data.session?.user
    if (!user) return this.set({ phase: 'signed-out' })
    this.set({ userId: user.id, email: user.email ?? undefined, error: undefined })
    await this.loadHousehold()
  }

  private async loadHousehold() {
    const meta = this.meta
    const { data, error } = await this.sb.rpc('my_household')
    if (error) {
      if (meta && meta.userId === this.state.userId) {
        // offline start: keep working with the linked household
        this.set({ phase: 'ready', net: 'offline', household: { id: meta.householdId, inviteCode: meta.inviteCode, slot: meta.slot, memberCount: 0, settings: undefined } })
        this.subscribeRealtime()
        return
      }
      return this.set({ phase: 'no-household', net: isNetworkError(error) ? 'offline' : 'error' })
    }
    const h = (data as Row[])[0]
    if (!h) return this.set({ phase: 'no-household', household: undefined })
    const household: HouseholdInfo = {
      id: h.household_id as string, inviteCode: h.invite_code as string, slot: h.slot as MemberId, memberCount: h.member_count as number,
      settings: { settings: h.settings as never, settings_updated_at: h.settings_updated_at as string },
    }
    if (meta && meta.householdId === household.id && meta.userId === this.state.userId) {
      this.saveMeta({ ...meta, inviteCode: household.inviteCode, slot: household.slot })
      this.set({ phase: 'ready', household })
      this.subscribeRealtime()
      this.syncNow()
    } else {
      this.set({ phase: 'needs-link', household })
    }
  }

  // ---------- Household ----------
  async createHousehold() {
    const s = store.getData().settings
    const { error } = await this.sb.rpc('create_household', {
      p_settings: { persons: s.persons, joint: s.joint },
      p_settings_updated_at: s.sharedUpdatedAt ?? new Date().toISOString(),
    })
    if (error) throw error
    await this.loadHousehold()
  }
  /**
   * Join another household while already in one. Only allowed when this account is the only member of
   * its current household (that empty/1-person household is removed server-side). Local entries stay on
   * the phone and are offered for upload in the following link step (default: move them over).
   */
  async switchHousehold(code: string) {
    const { error } = await this.sb.rpc('switch_household', { p_code: code })
    if (error) throw error
    this.unsubscribeRealtime()
    this.saveMeta(null)
    this.set({ household: undefined })
    await this.loadHousehold()
  }
  async joinHousehold(code: string) {
    const { error } = await this.sb.rpc('join_household', { p_code: code })
    if (error) throw error
    await this.loadHousehold()
  }
  /** Number of local records that could be uploaded into the household. */
  localCount() {
    return localRecordCount(store.getData())
  }
  /** Connect this device to the household: merge (upload) local data, or start fresh from household data. */
  async link(mode: 'merge' | 'replace', swap = false) {
    const h = this.state.household
    const uid = this.state.userId
    if (!h || !uid) return
    const cur = store.getData()
    if (localRecordCount(cur) > 0 && !localStorage.getItem(BACKUP_KEY)) {
      localStorage.setItem(BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: cur }))
    }
    let next: AppData
    if (mode === 'replace') {
      const e = emptyData()
      next = { ...e, settings: { ...e.settings, theme: cur.settings.theme, sharedUpdatedAt: undefined } }
    } else {
      next = ensureUuids(cur)
      if (swap) next = swapPersons(next)
      // Joining partner: names/emoji come from the household (set by whoever created it)
      if (h.slot === 'p2') next = { ...next, settings: { ...next.settings, sharedUpdatedAt: undefined } }
    }
    next = { ...next, settings: { ...next.settings, lastPersonId: h.slot } }
    store.replaceData(next)
    this.saveMeta({ userId: uid, householdId: h.id, slot: h.slot, inviteCode: h.inviteCode, cursors: {}, versions: {} })
    this.set({ phase: 'ready' })
    this.subscribeRealtime()
    await this.syncNow()
  }

  async signOut() {
    this.unsubscribeRealtime()
    try {
      await this.sb.auth.signOut({ scope: 'local' })
    } catch {
      /* offline: local sign-out still happens */
    }
    this.onSignedOut()
  }
  private onSignedOut() {
    this.unsubscribeRealtime()
    this.saveMeta(null)
    this.set({ phase: 'signed-out', household: undefined, userId: undefined, email: undefined, net: 'idle', lastSyncAt: undefined })
  }
  /** After "Alle Daten löschen" on this device: pull everything again. */
  resetCursors() {
    const m = this.meta
    if (m) this.saveMeta({ ...m, cursors: {}, versions: {} })
    this.syncNow()
  }

  // ---------- Sync ----------
  private schedule(key: string, ms: number) {
    if (this.state.phase !== 'ready') return
    window.clearTimeout(this.timers[key])
    this.timers[key] = window.setTimeout(() => this.syncNow(), ms)
  }

  async syncNow(): Promise<void> {
    if (this.state.phase !== 'ready' || !this.client) return
    if (this.running) {
      this.rerun = true
      return
    }
    if (!navigator.onLine) return this.set({ net: 'offline' })
    this.running = true
    this.set({ net: 'syncing' })
    try {
      await this.pull()
      await this.push()
      this.set({ net: 'idle', lastSyncAt: new Date().toISOString(), error: undefined })
    } catch (e) {
      console.warn('Sync fehlgeschlagen', e)
      this.set({ net: isNetworkError(e) ? 'offline' : 'error', error: isNetworkError(e) ? undefined : String((e as Error).message ?? e) })
    } finally {
      this.running = false
      if (this.rerun) {
        this.rerun = false
        this.schedule('rerun', 300)
      }
    }
  }

  private async fetchSince(table: Table, hid: string, since?: string): Promise<{ rows: Row[]; max?: string }> {
    const rows: Row[] = []
    let cursor = since ? new Date(ts(since) - 10_000).toISOString() : '1970-01-01T00:00:00Z'
    let max = since
    for (;;) {
      const { data, error } = await this.sb.from(table).select('*').eq('household_id', hid).gt('server_updated_at', cursor).order('server_updated_at').limit(1000)
      if (error) throw error
      rows.push(...(data as Row[]))
      if (data.length) {
        cursor = (data[data.length - 1] as Row).server_updated_at as string
        if (!max || ts(cursor) > ts(max)) max = cursor
      }
      if (data.length < 1000) break
    }
    return { rows, max }
  }

  private async pull() {
    const meta = this.meta
    if (!meta) return
    const hid = meta.householdId
    const { data: hh, error: he } = await this.sb.rpc('my_household')
    if (he) throw he
    const h = (hh as Row[])[0]
    if (!h || h.household_id !== hid) {
      // removed from household
      this.saveMeta(null)
      this.unsubscribeRealtime()
      this.set({ phase: 'no-household', household: undefined, householdGone: true, net: 'idle', error: undefined })
      return false
    }
    this.set({
      household: { id: hid, inviteCode: h.invite_code as string, slot: h.slot as MemberId, memberCount: h.member_count as number, settings: { settings: h.settings as never, settings_updated_at: h.settings_updated_at as string } },
    })
    const batch: RemoteBatch = {
      household: { settings: h.settings as never, settings_updated_at: h.settings_updated_at as string },
      transactions: [], recurring_rules: [], savings_goals: [], goal_contributions: [], budgets: [], checkins: [], badges: [],
    }
    const cursors = { ...meta.cursors }
    for (const t of TABLES) {
      const { rows, max } = await this.fetchSince(t, hid, meta.cursors[t])
      batch[t] = rows
      if (max) cursors[t] = max
    }
    const versions = { ...meta.versions }
    const merged = mergeRemote(store.getData(), batch, versions)
    if (merged !== store.getData()) store.applyRemote(() => merged)
    this.saveMeta({ ...meta, cursors, versions: { ...this.meta!.versions, ...versions } })
  }

  private async push() {
    const meta = this.meta
    if (!meta) return
    const hid = meta.householdId
    const v = meta.versions
    const d = store.getData()
    const done: Versions = {}
    const changed = <T extends { id: string; updatedAt: string }>(items: T[], prefix: string) =>
      items.filter((x) => isUuid(x.id) && v[`${prefix}:${x.id}`] !== ts(x.updatedAt))

    // settings (names/emoji)
    const sv = ts(d.settings.sharedUpdatedAt)
    if (sv && v.settings !== sv) {
      const { error } = await this.sb.rpc('update_household_settings', {
        p_household: hid, p_settings: { persons: d.settings.persons, joint: d.settings.joint }, p_updated_at: d.settings.sharedUpdatedAt,
      })
      if (error) throw error
      done.settings = sv
    }
    const up = async (table: Table, rows: Row[], keys: string[], vals: number[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await this.sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: opts.onConflict ?? 'id', ignoreDuplicates: opts.ignoreDuplicates })
        if (error) throw error
        keys.slice(i, i + 500).forEach((k, j) => (done[k] = vals[i + j]))
      }
    }
    const rules = changed(d.recurring, 'rule')
    await up('recurring_rules', rules.map((r) => ruleRow(r, hid)), rules.map((r) => `rule:${r.id}`), rules.map((r) => ts(r.updatedAt)))
    const goals = changed(d.goals, 'goal')
    await up('savings_goals', goals.map((g) => goalRow(g, hid)), goals.map((g) => `goal:${g.id}`), goals.map((g) => ts(g.updatedAt)))
    const contribs = d.goals.filter((g) => isUuid(g.id)).flatMap((g) => g.contributions.filter((c) => isUuid(c.id) && !v[`contrib:${c.id}`]).map((c) => ({ c, g })))
    await up('goal_contributions', contribs.map(({ c, g }) => contribRow(c, g.id, hid)), contribs.map(({ c }) => `contrib:${c.id}`), contribs.map(() => 1), { ignoreDuplicates: true })
    const txs = changed(d.transactions, 'tx')
    await up('transactions', txs.map((t) => txRow(t, hid)), txs.map((t) => `tx:${t.id}`), txs.map((t) => ts(t.updatedAt)))
    const budgets = Object.entries(d.budgets).filter(([cat, b]) => v[`budget:${cat}`] !== ts(b.updatedAt))
    await up('budgets', budgets.map(([cat, b]) => budgetRow(cat, b, hid)), budgets.map(([cat]) => `budget:${cat}`), budgets.map(([, b]) => ts(b.updatedAt)), { onConflict: 'household_id,category_id' })
    const checkins = changed(d.checkins, 'checkin')
    await up('checkins', checkins.map((c) => checkinRow(c, hid)), checkins.map((c) => `checkin:${c.id}`), checkins.map((c) => ts(c.updatedAt)))
    const badges = Object.entries(d.badges).filter(([id]) => !v[`badge:${id}`])
    await up('badges', badges.map(([id, at]) => badgeRow(id, at, hid)), badges.map(([id]) => `badge:${id}`), badges.map(() => 1), { onConflict: 'household_id,badge_id', ignoreDuplicates: true })

    if (Object.keys(done).length) {
      const m = this.meta!
      this.saveMeta({ ...m, versions: { ...m.versions, ...done } })
    }
  }

  // ---------- Realtime ----------
  private subscribeRealtime() {
    const m = this.meta
    if (!m || this.channel || !this.client) return
    const ch = this.client.channel(`hh-${m.householdId}`)
    for (const t of TABLES) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `household_id=eq.${m.householdId}` }, () => this.schedule('rt', 400))
    }
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${m.householdId}` }, () => this.schedule('rt', 400))
    ch.subscribe((status) => status === 'SUBSCRIBED' && this.schedule('rt', 100))
    this.channel = ch
  }
  private unsubscribeRealtime() {
    if (this.channel && this.client) this.client.removeChannel(this.channel)
    this.channel = null
  }
}

export const sync = new SyncEngine()

export function useSync() {
  return useSyncExternalStore(sync.subscribe, sync.getSnapshot)
}
