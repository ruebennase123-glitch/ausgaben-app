// push-dispatch: sends the app's Web-Push notifications (German). Called
//  - every 5 min by pg_cron (header x-cron-secret) with {"action":"dispatch"}
//  - by a signed-in user with {"action":"test"} (Authorization: Bearer <user JWT>) → test push to own devices
// All scheduling decisions are made in Europe/Berlin time.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPush } from './webpush.js'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const VAPID = { publicKey: Deno.env.get('VAPID_PUBLIC_KEY')!, privateKey: Deno.env.get('VAPID_PRIVATE_KEY')!, subject: 'https://ruebennase123-glitch.github.io/ausgaben-app/' }
const CRON_SECRET = Deno.env.get('PUSH_CRON_SECRET')!
const TZ = 'Europe/Berlin'

const CAT: Record<string, string> = {
  lebensmittel: 'Einkäufe', wohnen: 'Wohnen', mobilitaet: 'Mobilität', freizeit: 'Freizeit', restaurant: 'Restaurant', gesundheit: 'Gesundheit',
  kleidung: 'Shopping', abos: 'Abos', geschenke: 'Geschenke', renovieren: 'Renovieren', urlaub: 'Urlaub', 'urlaub-gemeinsam': 'Urlaub', picnic: 'Einkäufe',
  lieferando: 'Lieferando', dating: 'Dating', beauty: 'Beauty', versicherungen: 'Versicherungen', sparen: 'Sparen/Rücklagen', sonstiges: 'Sonstiges',
}
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const fmt = (cents: number) => eur.format(cents / 100)

type Row = Record<string, any>
type Msg = { title: string; body: string; url: string; tag: string }

// ---------- Berlin time helpers ----------
function berlin(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, day: Number(p.day), minutes: Number(p.hour) * 60 + Number(p.minute) }
}
/** UTC instant of local midnight (Europe/Berlin) of an ISO date. */
function berlinMidnight(date: string): Date {
  const guess = new Date(`${date}T00:00:00Z`)
  const b = berlin(guess)
  const offsetMin = (Date.UTC(+b.date.slice(0, 4), +b.date.slice(5, 7) - 1, +b.date.slice(8, 10)) + b.minutes * 60000 - guess.getTime()) / 60000
  return new Date(guess.getTime() - offsetMin * 60000)
}
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const prevMonth = (m: string) => { const d = new Date(`${m}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }
const nextMonth = (m: string) => { const d = new Date(`${m}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7) }

// ---------- sending ----------
async function sendToUser(userId: string, msg: Msg, stats: Row) {
  const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', userId)
  for (const s of subs ?? []) {
    try {
      const r = await sendPush(s, msg, VAPID, { topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined })
      if (r.ok) {
        stats.sent++
        await sb.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), failures: 0 }).eq('id', s.id)
      } else if (r.gone || s.failures >= 5) {
        stats.removed++
        await sb.from('push_subscriptions').delete().eq('id', s.id)
      } else {
        stats.failed++
        await sb.from('push_subscriptions').update({ failures: s.failures + 1 }).eq('id', s.id)
      }
    } catch (e) {
      stats.failed++
      console.error('push failed', (e as Error).message)
    }
  }
}

async function liveTx(hid: string, filter: (q: any) => any) {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(sb.from('transactions').select('type,amount_cents,category_id,person_id,created_by,created_at,date,recurring_id').eq('household_id', hid).eq('deleted', false)).range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) return out
  }
}

// ---------- the four notification types ----------
async function evening(p: Row, m: Row, now: Date, stats: Row) {
  const b = berlin(now)
  const [hh, mm] = String(p.evening_time).split(':').map(Number)
  const due = hh * 60 + mm
  if (!p.evening_enabled || p.last_evening_sent === b.date || b.minutes < due || b.minutes > due + 120) return
  await sb.from('notification_prefs').update({ last_evening_sent: b.date }).eq('user_id', p.user_id)
  const yesterday = addDays(b.date, -1)
  const mine = `person_id.eq.${m.slot},created_by.eq.${p.user_id}`
  const since = berlinMidnight(yesterday).toISOString()
  const txs = await liveTx(m.household_id, (q) => q.or(mine).gte('created_at', since))
  const { data: cks } = await sb.from('checkins').select('date').eq('household_id', m.household_id).eq('person_id', m.slot).eq('deleted', false).gte('date', yesterday)
  const today0 = berlinMidnight(b.date).getTime()
  const today = txs.some((t) => new Date(t.created_at).getTime() >= today0) || (cks ?? []).some((c) => c.date === b.date)
  const yest = txs.some((t) => new Date(t.created_at).getTime() < today0) || (cks ?? []).some((c) => c.date === yesterday)
  if (today || !yest) return // nothing at risk
  await sendToUser(p.user_id, { title: '🔥 Deine Serie ist in Gefahr', body: 'Heute ist noch nichts eingetragen. Kurz eine Ausgabe erfassen oder „Heute nichts ausgegeben“ abhaken.', url: './#entry', tag: 'evening' }, stats)
}

async function monthly(p: Row, m: Row, now: Date, stats: Row) {
  const b = berlin(now)
  if (!p.monthly_enabled || b.day !== 1 || b.minutes < 9 * 60 || p.last_monthly_sent === b.month) return
  await sb.from('notification_prefs').update({ last_monthly_sent: b.month }).eq('user_id', p.user_id)
  const last = prevMonth(b.month)
  const txs = await liveTx(m.household_id, (q) => q.gte('date', `${last}-01`).lt('date', `${b.month}-01`))
  if (!txs.length) return
  let inc = 0, exp = 0
  const byCat = new Map<string, number>()
  for (const t of txs) {
    if (t.type === 'income') inc += t.amount_cents
    else { exp += t.amount_cents; byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + t.amount_cents) }
  }
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0]
  const bal = inc - exp
  const name = MONTHS[Number(last.slice(5, 7)) - 1]
  await sendToUser(p.user_id, {
    title: `📊 Monatsbericht ${name}`,
    body: `Saldo ${bal > 0 ? '+' : ''}${fmt(bal)} (Einnahmen ${fmt(inc)}, Ausgaben ${fmt(exp)}).${top ? ` Größte Kategorie: ${CAT[top[0]] ?? top[0]} mit ${fmt(top[1])}.` : ''}`,
    url: './#overview', tag: `monthly-${last}`,
  }, stats)
}

async function partner(p: Row, m: Row, hh: Row, now: Date, stats: Row) {
  if (!p.partner_enabled) return
  const txs = (await liveTx(m.household_id, (q) => q.gt('created_at', p.partner_cursor).not('created_by', 'is', null).neq('created_by', p.user_id).is('recurring_id', null)))
  if (!txs.length) return
  const times = txs.map((t) => new Date(t.created_at).getTime())
  const newest = Math.max(...times), oldest = Math.min(...times)
  // batch: wait for 10 quiet minutes, but at most 30 minutes after the first new entry
  if (now.getTime() - newest < 10 * 60000 && now.getTime() - oldest < 30 * 60000) return
  await sb.from('notification_prefs').update({ partner_cursor: new Date(newest).toISOString() }).eq('user_id', p.user_id)
  const other = m.slot === 'p1' ? 1 : 0
  const who = hh.settings?.persons?.[other]?.name || 'Dein Partner'
  const exp = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount_cents, 0)
  const n = txs.length
  await sendToUser(p.user_id, {
    title: `✍️ ${who} hat ${n === 1 ? 'etwas' : `${n} Buchungen`} eingetragen`,
    body: n === 1 ? `${CAT[txs[0].category_id] ?? 'Buchung'}: ${txs[0].type === 'income' ? '+' : '−'}${fmt(txs[0].amount_cents)}` : `Zusammen ${exp ? `−${fmt(exp)} Ausgaben` : 'nur Einnahmen'}.`,
    url: './#overview', tag: 'partner',
  }, stats)
}

async function budgets(hid: string, members: Row[], prefs: Map<string, Row>, now: Date, stats: Row) {
  const month = berlin(now).month
  const { data: bs } = await sb.from('budgets').select('category_id,limit_cents').eq('household_id', hid).eq('deleted', false).gt('limit_cents', 0)
  if (!bs?.length) return
  const txs = await liveTx(hid, (q) => q.eq('type', 'expense').gte('date', `${month}-01`).lt('date', `${nextMonth(month)}-01`))
  const { data: sent } = await sb.from('budget_alerts_sent').select('category_id,level').eq('household_id', hid).eq('month', month)
  const has = new Set((sent ?? []).map((s) => `${s.category_id}|${s.level}`))
  for (const b of bs) {
    const spent = txs.filter((t) => t.category_id === b.category_id).reduce((s, t) => s + t.amount_cents, 0)
    const ratio = spent / b.limit_cents
    const level = ratio >= 1 ? 100 : ratio >= 0.8 ? 80 : 0
    if (!level || has.has(`${b.category_id}|${level}`)) continue
    const marks = (level === 100 ? [80, 100] : [80]).map((l) => ({ household_id: hid, category_id: b.category_id, month, level: l }))
    await sb.from('budget_alerts_sent').upsert(marks, { onConflict: 'household_id,category_id,month,level', ignoreDuplicates: true })
    const name = CAT[b.category_id] ?? b.category_id
    const msg: Msg = level === 100
      ? { title: `⚠️ Budget ${name} überschritten`, body: `${fmt(spent)} von ${fmt(b.limit_cents)} ausgegeben (${Math.round(ratio * 100)} %).`, url: './#plan', tag: `budget-${b.category_id}` }
      : { title: `⏳ Budget ${name} zu 80 % aufgebraucht`, body: `${fmt(spent)} von ${fmt(b.limit_cents)} – noch ${fmt(b.limit_cents - spent)} übrig.`, url: './#plan', tag: `budget-${b.category_id}` }
    for (const m of members) if (prefs.get(m.user_id)?.budget_enabled) await sendToUser(m.user_id, msg, stats)
  }
}

async function dispatch(now: Date, onlyUsers?: string[]) {
  const stats = { sent: 0, failed: 0, removed: 0, users: 0, households: 0 }
  let pq = sb.from('notification_prefs').select('*')
  if (onlyUsers) pq = pq.in('user_id', onlyUsers)
  const { data: prefs, error } = await pq
  if (error) throw error
  const prefMap = new Map((prefs ?? []).map((p) => [p.user_id, p]))
  if (!prefMap.size) return stats
  const { data: subs } = await sb.from('push_subscriptions').select('user_id')
  const withSubs = new Set((subs ?? []).map((s) => s.user_id))
  const { data: mems } = await sb.from('household_members').select('household_id,user_id,slot').in('user_id', [...prefMap.keys()])
  const hids = [...new Set((mems ?? []).map((m) => m.household_id))]
  const { data: allMembers } = hids.length ? await sb.from('household_members').select('household_id,user_id,slot').in('household_id', hids) : { data: [] }
  const { data: hhs } = hids.length ? await sb.from('households').select('id,settings').in('id', hids) : { data: [] }
  const hhMap = new Map((hhs ?? []).map((h) => [h.id, h]))
  for (const m of mems ?? []) {
    const p = prefMap.get(m.user_id)!
    if (!withSubs.has(m.user_id)) continue
    stats.users++
    try {
      await evening(p, m, now, stats)
      await monthly(p, m, now, stats)
      await partner(p, m, hhMap.get(m.household_id) ?? {}, now, stats)
    } catch (e) { console.error('user dispatch failed', (e as Error).message) }
  }
  for (const hid of hids) {
    stats.households++
    try {
      await budgets(hid, (allMembers ?? []).filter((x) => x.household_id === hid && (!onlyUsers || onlyUsers.includes(x.user_id))), prefMap, now, stats)
    } catch (e) { console.error('budget dispatch failed', (e as Error).message) }
  }
  return stats
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({})
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const body = await req.json().catch(() => ({}))
  if (body.action === 'dispatch') {
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'forbidden' }, 403)
    // Simulated time is only allowed for an explicit list of (test) users – never for everyone.
    if (body.now && !(Array.isArray(body.user_ids) && body.user_ids.length)) return json({ error: 'now requires user_ids' }, 400)
    const now = body.now ? new Date(body.now) : new Date()
    return json(await dispatch(now, body.user_ids))
  }
  if (body.action === 'test') {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data, error } = await sb.auth.getUser(token)
    if (error || !data.user) return json({ error: 'unauthorized' }, 401)
    const stats = { sent: 0, failed: 0, removed: 0 }
    await sendToUser(data.user.id, { title: '🔔 Benachrichtigungen aktiv', body: 'So sehen Hinweise vom Haushaltsbuch aus.', url: './#settings', tag: 'test' }, stats)
    return json(stats)
  }
  return json({ error: 'unknown action' }, 400)
})
