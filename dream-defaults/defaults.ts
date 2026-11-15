/** Which threshold each of dream's built-in automations gets in a chapter. Pure; `server.ts` applies it. */

/** `dreamDefaults` in `~/.ultimate/settings.json`: a context percentage for each built-in. */
export type Defaults = { beforeCompaction?: number; afterPause?: number }

/**
 * Dream's two built-ins: the setting naming each, the idempotency key dream creates it with, the seed field a new
 * chapter makes it from, and upstream's threshold, the only one this extension replaces.
 */
export const BUILT_INS = [
  {
    setting: 'beforeCompaction',
    key: 'dream:dream.after-compaction',
    seed: 'builtIn',
    upstream: 70,
  },
  { setting: 'afterPause', key: 'dream:dream.after-pause', seed: 'builtInPause', upstream: 50 },
] as const
export type BuiltIn = (typeof BUILT_INS)[number]

/** The kinds of dream's documents that record each built-in's id: a commit to one means dream made or lost it. */
export const DREAM_DOCS = ['dream.after-compaction', 'dream.after-pause']

/** The settings value as given, keeping only whole percentages from 1 to 99; undefined without any. */
export function defaultsOf(value: unknown): Defaults | undefined {
  if (!value || typeof value !== 'object') return undefined
  const defaults: Defaults = {}
  for (const { setting } of BUILT_INS) {
    const above = (value as Record<string, unknown>)[setting]
    if (typeof above === 'number' && Number.isInteger(above) && above >= 1 && above <= 99)
      defaults[setting] = above
  }
  return Object.keys(defaults).length ? defaults : undefined
}

type Found = { enabled: boolean; condition?: { above: number } }

/**
 * One built-in this chapter: `wait` while dream has not made it, `leave` once it needs nothing, or the threshold to set.
 * Only an enabled automation still at upstream's threshold changes, and only when the chapter's seed carried it
 * enabled and without a condition of its own: a pause, a deletion, an edit and a carried threshold are the user's.
 */
export function decide(
  builtIn: BuiltIn,
  defaults: Defaults,
  automation: Found | undefined,
  seed: Record<string, unknown> | undefined,
): 'wait' | 'leave' | number {
  const carried = seed?.[builtIn.seed] as
    | { enabled?: boolean; condition?: unknown }
    | null
    | undefined
  // Dream makes a seeded pause enabled first and pauses it after: the seed says what it will be.
  if (carried === null || carried?.enabled === false) return 'leave'
  if (!automation) return 'wait'
  const want = defaults[builtIn.setting]
  if (
    want === undefined ||
    carried?.condition !== undefined ||
    !automation.enabled ||
    automation.condition?.above !== builtIn.upstream
  )
    return 'leave'
  return want
}
