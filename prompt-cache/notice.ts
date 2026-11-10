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

/** A model's prices per million tokens, as Pi lists them. */
export type Rates = { input: number; cacheRead: number; cacheWrite: number }

/**
 * Whose API list price stands in for a model listed at $0, by the same model ID. Subscription proxies such as cliproxy
 * list every model at $0, so their replies would cost nothing.
 */
const MAKERS = ['anthropic', 'openai', 'google']

/** The model `provider`/`id` if it lists prices, else the same model ID at its maker's API price. */
export function priced<M extends { cost: Rates }>(
  find: (provider: string, id: string) => M | undefined,
  provider: string,
  id: string,
): M | undefined {
  const own = find(provider, id)
  if (own && (own.cost.input > 0 || own.cost.cacheWrite > 0)) return own
  for (const maker of MAKERS) {
    const model = find(maker, id)
    if (model && model.cost.input > 0) return model
  }
  return own
}

/** A reply's token counts and what they cost, as Pi's `Usage` records them. */
export type Usage = {
  input: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h?: number
  cost: { input: number; cacheRead: number; cacheWrite: number }
}

/**
 * What a reply paid over a cache hit for `missed` prompt tokens it wrote instead of read, as Pi's `collectCacheMisses`
 * prices it: its paid rate (input and cache write) minus the cache read rate. A reply recorded at $0 is priced at
 * `rates`, with one-hour writes at twice the input rate as Pi's `calculateCost` does.
 */
export function missCost(usage: Usage, missed: number, rates: Rates | undefined) {
  const paidTokens = usage.input + usage.cacheWrite
  const recorded = usage.cost.input + usage.cost.cacheWrite + usage.cost.cacheRead > 0
  if (!recorded && !rates) return 0
  const long = usage.cacheWrite1h ?? 0
  const paid = recorded
    ? usage.cost.input + usage.cost.cacheWrite
    : (rates!.input * (usage.input + 2 * long) + rates!.cacheWrite * (usage.cacheWrite - long)) /
      1_000_000
  const readPerToken =
    recorded && usage.cacheRead > 0
      ? usage.cost.cacheRead / usage.cacheRead
      : (rates?.cacheRead ?? 0) / 1_000_000
  const paidPerToken = paidTokens > 0 ? paid / paidTokens : 0
  return missed * Math.max(0, paidPerToken - readPerToken)
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
