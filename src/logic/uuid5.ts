// RFC 4122 UUID v5 (SHA-1, name-based) – synchronous, no dependencies.
// Used for deterministic ids of auto-generated recurring entries, so two devices
// generating the same month's entry produce the same row (no double booking).

function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length * 8
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  withPad.set(bytes)
  withPad[bytes.length] = 0x80
  const dv = new DataView(withPad.buffer)
  dv.setUint32(withPad.length - 4, ml >>> 0)
  dv.setUint32(withPad.length - 8, Math.floor(ml / 2 ** 32))
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = (x << 1) | (x >>> 31)
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f: number, k: number
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0
  }
  const out = new Uint8Array(20)
  const odv = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => odv.setUint32(i * 4, h))
  return out
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

export function uuidv5(name: string, namespace: string): string {
  const ns = new Uint8Array(namespace.replace(/-/g, '').match(/../g)!.map((h) => parseInt(h, 16)))
  const nameBytes = new TextEncoder().encode(name)
  const buf = new Uint8Array(ns.length + nameBytes.length)
  buf.set(ns)
  buf.set(nameBytes, ns.length)
  const h = sha1(buf).slice(0, 16)
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const s = hex(h)
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

/** Namespace for this app's recurring entries (random, fixed forever). */
export const RECURRING_NS = '6f1c2b0e-8d4a-4c55-9a51-3b7e2d9f4a10'

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
