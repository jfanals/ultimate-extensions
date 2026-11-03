/** What the cache notices say and when they show. Browser-safe: the server filters with it, the transcript words it. */

/** A cache miss Pi's `collectCacheMisses` counted, on the reply that paid for it. */
export type Miss = {
  /** The reply that paid. */
  reply: number
  /** The row the notice follows: the input that started the reply, or the reply itself (shown above it). */
  anchor: number
  /** When the reply came back (ms). */
  at: number
  missedTokens: number
  missedCost: number
  idleMs: number
  modelChanged: boolean
}

/** One keep-warm ping on @ultimate's cache, as this extension recorded it; `after` is the reply it follows. */
export type Warm = {
  at: number
  conversation: number
  model: string
  read?: number
  write?: number
  /** Estimated from the model's prices; keep-warm keeps only the token counts. */
  cost?: number
  error?: string
}

export type Settings = { showMisses: boolean; showWarms: boolean }

/** Pi's notice threshold (interactive mode): small misses are cache breakpoint noise, not worth a line. */
export const shown = (miss: Pick<Miss, 'missedTokens' | 'missedCost'>) =>
  miss.missedTokens >= 20_000 || miss.missedCost >= 0.1

/** Anthropic's short cache lives 5 minutes; a gap at least this long is named as the likely cause, as Pi does. */
const IDLE = 5 * 60_000

/** 12m, 4h 45m. */
export function idle(ms: number) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** 174k, 1.2M; Pi's footer rounding. */
export function tokens(count: number) {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

export const dollars = (cost: number) => `$${cost.toFixed(2)}`

/** `Cache rebuilt after 4h 45m idle · 174k tokens · $1.39`, Pi's wording for its "Cache miss" notice. */
export function missText(miss: Miss) {
  const cause = miss.modelChanged
    ? ' after model switch'
    : miss.idleMs >= IDLE
      ? ` after ${idle(miss.idleMs)} idle`
      : ''
  const cost = miss.missedCost >= 0.01 ? ` · ${dollars(miss.missedCost)}` : ''
  return `Cache rebuilt${cause} · ${tokens(miss.missedTokens)} tokens${cost}`
}

/** The pings after one reply as one line: `cache warmed · $0.06`, `cache warmed 3× · $0.18`. */
export function warmText(warms: readonly Warm[]) {
  const ok = warms.filter((warm) => warm.error === undefined)
  if (ok.length === 0) return undefined
  const cost = ok.reduce((sum, warm) => sum + (warm.cost ?? 0), 0)
  return `cache warmed${ok.length > 1 ? ` ${ok.length}×` : ''}${cost >= 0.01 ? ` · ${dollars(cost)}` : ''}`
}

/** A failed ping: `cache warm failed · <reason>`. */
export const failText = (warm: Warm) => `cache warm failed · ${warm.error}`

/** The reply each ping follows: the newest reply in @ultimate before it. */
export function warmAnchor(replies: readonly { id: number; at: number }[], warm: Warm) {
  let anchor: number | undefined
  for (const reply of replies) if (reply.at < warm.at) anchor = reply.id
  return anchor
}
