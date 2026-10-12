// Minimal Web Push sender (RFC 8291 aes128gcm + RFC 8292 VAPID) on WebCrypto – runs in Deno and Node ≥ 20.
const enc = new TextEncoder()
const b64u = {
  enc: (buf) => {
    const b = new Uint8Array(buf)
    let s = ''
    for (const x of b) s += String.fromCharCode(x)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  dec: (str) => {
    const s = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4)
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  },
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8))
}

/** Encrypt payload for one subscription ({ p256dh, auth } base64url). */
export async function encryptPayload(sub, payload) {
  const uaPublic = b64u.dec(sub.p256dh)
  const authSecret = b64u.dec(sub.auth)
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256))
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plain = concat(enc.encode(payload), new Uint8Array([2]))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain))
  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  return concat(header, asPublic, cipher)
}

let signingKey
async function vapidKey(publicKey, privateKey) {
  if (signingKey) return signingKey
  const pub = b64u.dec(publicKey)
  const jwk = { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ext: true }
  signingKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  return signingKey
}
async function vapidJwt(aud, subject, publicKey, privateKey) {
  const head = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(publicKey, privateKey), enc.encode(`${head}.${body}`))
  return `${head}.${body}.${b64u.enc(sig)}`
}

/**
 * Send one push. Returns { ok, status, gone } – gone = subscription expired (404/410), delete it.
 * vapid = { publicKey, privateKey (base64url d), subject ('mailto:…' or https URL) }
 */
export async function sendPush(sub, payload, vapid, { ttl = 86400, urgency = 'normal', topic } = {}) {
  const body = await encryptPayload(sub, typeof payload === 'string' ? payload : JSON.stringify(payload))
  const aud = new URL(sub.endpoint).origin
  const jwt = await vapidJwt(aud, vapid.subject, vapid.publicKey, vapid.privateKey)
  const headers = {
    Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
  }
  if (topic) headers.Topic = topic
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body })
  const text = res.ok ? '' : (await res.text()).slice(0, 200)
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, text }
}
