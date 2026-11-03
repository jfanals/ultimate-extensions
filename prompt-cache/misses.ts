/**
 * Cache misses of one conversation, counted by Pi's own `collectCacheMisses` (pi-coding-agent `core/cache-stats.js`,
 * not in its public index, so it is loaded by path from the clone's `node_modules`). Ultimate's entries become the Pi session entries it reads: replies as messages, context starts as compactions,
 * keep-warm pings as `cache_warm` usage.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Miss, Warm } from './notice.ts'

/** The parts of an Ultimate entry this reads (`EntryRecord`). */
export type Entry = {
  id: number
  kind: string
  model?: readonly { role: string; timestamp: number; usage?: unknown }[]
}

type PiMiss = {
  missedTokens: number
  missedCost: number
  idleMs: number
  modelChanged: boolean
}
export type Collect = (
  entries: object[],
  models: {
    getModel(provider: string, id: string): { cost: { cacheRead: number } } | undefined
  },
) => Map<object, PiMiss>

/** Pi's `collectCacheMisses`, from the Ultimate clone at `root`. */
export async function loadCollect(root: string): Promise<Collect> {
  const path = join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/core/cache-stats.js')
  return (
    (await import(/* @vite-ignore */ pathToFileURL(path).href)) as { collectCacheMisses: Collect }
  ).collectCacheMisses
}

/**
 * Every miss Pi counts in `entries` (oldest first). `warms` are the conversation's keep-warm pings; a ping renews the
 * cache, so the idle time runs from it.
 */
export function missesOf(
  entries: readonly Entry[],
  warms: readonly Warm[],
  collect: Collect,
  models: Parameters<Collect>[1],
): Miss[] {
  const session: object[] = []
  const pings = warms.filter((warm) => warm.error === undefined).toSorted((a, b) => a.at - b.at)
  let next = 0
  let compacted = false
  for (const entry of entries) {
    if (entry.kind === 'pi.compaction' || entry.kind === 'pi.reset') {
      session.push({ type: 'compaction' })
      compacted = true
      continue
    }
    const message = entry.model?.[0]
    if (entry.kind !== 'pi.assistant' || message?.role !== 'assistant') continue
    // Entries carry no time, so pings since the last reply may predate the new context: dropping them can only hide a
    // miss after it, never invent one from the old context's size.
    if (compacted) while (next < pings.length && pings[next].at < message.timestamp) next++
    compacted = false
    for (; next < pings.length && pings[next].at < message.timestamp; next++) {
      const ping = pings[next]
      session.push({
        type: 'usage',
        kind: 'cache_warm',
        provider: (message as { provider?: string }).provider,
        model: ping.model,
        usage: {
          input: 0,
          cacheRead: ping.read ?? 0,
          cacheWrite: ping.write ?? 0,
        },
        timestamp: new Date(ping.at).toISOString(),
      })
    }
    session.push({ type: 'message', message })
  }
  return [...collect(session, models)].map(([message, miss]) => ({
    at: (message as { timestamp: number }).timestamp,
    missedTokens: miss.missedTokens,
    missedCost: miss.missedCost,
    idleMs: miss.idleMs,
  }))
}
