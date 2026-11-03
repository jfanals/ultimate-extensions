/** What the warm lines and the chip say. Browser-safe: the server counts with it, the transcript and chip word it. */

/** A cache miss Pi's `collectCacheMisses` counted, on the reply that paid for it. */
export type Miss = {
  /** When the reply came back (ms). */
  at: number
  missedTokens: number
  missedCost: number
  /** Since the previous reply or ping. */
  idleMs: number
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

/** Pi's notice threshold (interactive mode): small misses are cache breakpoint noise, not counted. */
export const shown = (miss: Pick<Miss, 'missedTokens' | 'missedCost'>) =>
  miss.missedTokens >= 20_000 || miss.missedCost >= 0.1

export const dollars = (cost: number) => `$${cost.toFixed(2)}`

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
