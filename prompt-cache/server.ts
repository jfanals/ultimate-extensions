/**
 * Cache: what rebuilding conversations' prompt caches cost (Pi's `collectCacheMisses` over their replies) and when
 * keep-warm renewed @ultimate's. keep-warm keeps only its last ping, so a timer copies each finished ping into `cache.warms`.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { calculateCost } from '@earendil-works/pi-ai'
import type { Api, Model, Usage } from '@earendil-works/pi-ai'
import { defineDoc, defineExtension, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type {
  ConversationDocToken,
  ConversationId,
  Cursor,
  Harness,
  JsonObject,
} from '@earendil-works/pi-durable'
import { loadCollect, missesOf } from './misses.ts'
import type { Collect, Entry } from './misses.ts'
import { shown } from './notice.ts'
import type { Miss, Warm } from './notice.ts'

/** The parts of `ExtensionHost` (`server/extensions.ts`) this facet uses. */
type Host = {
  userHome: string
  ultimateRoot: string
  modelRuntime: {
    getModel(provider: string, id: string): Model<Api> | undefined
  }
  conversations(): { id: number }[]
  doc(kind: string): ConversationDocToken<JsonObject> | undefined
  harness(): Harness
  notice(message: string): void
  resource<T>(key: string, create: () => T): T
  onClose(cleanup: () => Promise<void>): void
}
type Ctx = { host: Host; conversationId?: number }

/** keep-warm's `keep-warm.state` and its last ping, as `keep-warm/refs.ts` defines them. */
type Ping = {
  at: number
  model: string
  read?: number
  write?: number
  error?: string
}
type WarmState = { last?: Ping }

/** Every keep-warm ping since this extension was installed, oldest first; on conversation 1. */
const Warms = defineDoc<{ warms: Warm[] }>({
  kind: 'cache.warms',
  checkpointWhen: () => false,
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ warms: [] }),
})
export const docs = [Warms]

/** Pings kept: about three weeks at a ping an hour. */
const KEEP = 500
/** keep-warm pings Claude Code only. */
const PROVIDER = 'claude-code'
const TICK = 60_000
const WEEK = 7 * 24 * 60 * 60_000

/** `cache.showWarms` in `~/.ultimate/settings.json`, read at each call; defaults to true. */
export async function showWarms(userHome: string) {
  // A missing or invalid settings file (reported where settings load) counts as unset here.
  const value: unknown = await readFile(join(userHome, '.ultimate/settings.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))
  return (value as { cache?: { showWarms?: unknown } } | null)?.cache?.showWarms !== false
}

/** What a ping cost, from the model's prices: keep-warm keeps only its cache read and one-hour write. */
export function pingCost(model: Model<Api> | undefined, ping: Ping) {
  if (!model || ping.error !== undefined) return undefined
  const usage = {
    input: 0,
    output: 0,
    cacheRead: ping.read ?? 0,
    cacheWrite: ping.write ?? 0,
    cacheWrite1h: ping.write ?? 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  } as Usage
  return calculateCost(model, usage).total
}

/** keep-warm's last ping into `cache.warms`, once it finished; `interrupted` is its mark while a ping is in flight. */
async function record(host: Host) {
  const state = host.doc('keep-warm.state')
  const standing = host.doc('ultimate.standing-agents')
  if (!state || !standing) return
  const harness = host.harness()
  const last = (
    (await harness.snapshot(state, ROOT_CONVERSATION_ID, context)) as WarmState | undefined
  )?.last
  if (!last || last.error === 'interrupted') return
  const conversation = (
    (await harness.snapshot(standing, ROOT_CONVERSATION_ID, context)) as
      | { ultimate?: number }
      | undefined
  )?.ultimate
  if (conversation === undefined) return
  await harness.commit(async (tx) => {
    const doc = await tx.doc(Warms, ROOT_CONVERSATION_ID)
    if (doc.warms.some((warm) => warm.at === last.at)) return
    const cost = pingCost(host.modelRuntime.getModel(PROVIDER, last.model), last)
    doc.warms.push({
      ...last,
      conversation,
      ...(cost === undefined ? {} : { cost }),
    })
    if (doc.warms.length > KEEP) doc.warms.splice(0, doc.warms.length - KEEP)
  }, context)
}

async function warmsOf(host: Host) {
  return (await host.harness().snapshot(Warms, ROOT_CONVERSATION_ID, context))?.warms ?? []
}

/** A conversation's whole history, oldest first, with what Pi's count reads. */
async function entriesOf(host: Host, id: number): Promise<Entry[]> {
  const conversation = await host.harness().conversation(id as ConversationId, context)
  if (!conversation) return []
  const entries: Entry[] = []
  let cursor: Cursor | undefined
  do {
    const page = await conversation.entries({ order: 'ascending' }, 500, cursor, context)
    for (const entry of page.items)
      entries.push({
        id: entry.id,
        kind: entry.kind,
        ...(entry.input ? { input: true as const } : {}),
        ...(entry.model ? { model: entry.model } : {}),
      })
    cursor = page.next
  } while (cursor)
  return entries
}

/** Counted misses per conversation, kept until its newest entry changes. */
type Memo = Map<number, { newest: number; warmed: number; misses: Miss[] }>

async function missesIn(
  host: Host,
  memo: Memo,
  collect: Collect,
  id: number,
  warms: readonly Warm[],
) {
  const own = warms.filter((warm) => warm.conversation === id)
  const conversation = await host.harness().conversation(id as ConversationId, context)
  if (!conversation) return []
  const newest = (await conversation.entries({}, 1, undefined, context)).items[0]?.id ?? 0
  const kept = memo.get(id)
  if (kept && kept.newest === newest && kept.warmed === (own.at(-1)?.at ?? 0)) return kept.misses
  const entries = await entriesOf(host, id)
  const models = {
    getModel: (provider: string, model: string) => host.modelRuntime.getModel(provider, model),
  }
  const misses = missesOf(entries, own, collect, models).filter(shown)
  memo.set(id, { newest, warmed: own.at(-1)?.at ?? 0, misses })
  return misses
}

export default function cache(host: Host) {
  const shared = host.resource('cache.timer', () => ({
    running: undefined as Promise<void> | undefined,
  }))
  const timer = setInterval(() => {
    shared.running ??= record(host)
      .catch((error: unknown) => host.notice(`Cache: ${String(error)}`))
      .finally(() => {
        shared.running = undefined
      })
  }, TICK)
  host.onClose(async () => {
    clearInterval(timer)
    await shared.running
  })
  return defineExtension({ name: 'prompt-cache' })
}

const state = (host: Host) =>
  host.resource('cache.state', () => ({
    memo: new Map() as Memo,
    collect: loadCollect(host.ultimateRoot),
  }))

export const actions = {
  /** `{ conversation }` → the keep-warm pings on it, none when `cache.showWarms` is false. */
  warms: async (args: unknown, { host }: Ctx) => {
    const id = (args as { conversation?: unknown } | null)?.conversation
    if (!Number.isSafeInteger(id) || (id as number) < 1)
      throw new Error('Expected { conversation }')
    if (!(await showWarms(host.userHome))) return []
    return (await warmsOf(host)).filter((warm) => warm.conversation === id)
  },
  /** No arguments → the newest miss across conversations, this week's misses and warms. */
  summary: async (_args: unknown, { host }: Ctx) => {
    const { memo, collect } = state(host)
    const warms = await warmsOf(host)
    const since = Date.now() - WEEK
    const all: (Miss & { conversation: number })[] = []
    for (const { id } of host.conversations())
      for (const miss of await missesIn(host, memo, await collect, id, warms))
        all.push({ ...miss, conversation: id })
    const week = all.filter((miss) => miss.at >= since)
    const warmed = warms.filter((warm) => warm.at >= since && warm.error === undefined)
    const last = all.reduce<(typeof all)[number] | undefined>(
      (a, b) => (!a || b.at > a.at ? b : a),
      undefined,
    )
    return {
      ...(last ? { last } : {}),
      week: {
        count: week.length,
        cost: week.reduce((sum, miss) => sum + miss.missedCost, 0),
      },
      warmed: {
        count: warmed.length,
        cost: warmed.reduce((sum, warm) => sum + (warm.cost ?? 0), 0),
      },
      ...(warms.at(-1)?.error !== undefined ? { failed: warms.at(-1) } : {}),
    }
  },
}
