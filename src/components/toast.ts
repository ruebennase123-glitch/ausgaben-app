export interface ToastMsg {
  id: number
  text: string
  tone?: 'ok' | 'warn' | 'over'
  action?: { label: string; run: () => void }
}
type L = (t: ToastMsg | null) => void
let listener: L | null = null
let n = 0
let timer: number | undefined

export function onToast(l: L) {
  listener = l
  return () => {
    listener = null
  }
}
export function showToast(text: string, opts: Omit<ToastMsg, 'id' | 'text'> = {}) {
  window.clearTimeout(timer)
  listener?.({ id: ++n, text, ...opts })
  timer = window.setTimeout(() => listener?.(null), opts.action ? 5000 : 3000)
}
export function hideToast() {
  window.clearTimeout(timer)
  listener?.(null)
}
