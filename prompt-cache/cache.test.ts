/**
 * The cache notices' core paths, outside the clone's suites:
 * `ULTIMATE_ROOT=/path/to/ultimate node --test prompt-cache/cache.test.ts`.
 * Pi's own `collectCacheMisses` counts; these check the wiring to it, its threshold and the lines.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCollect, missesOf } from './misses.ts'
import type { Entry } from './misses.ts'
import { missText, shown, warmAnchor, warmText } from './notice.ts'
import type { Warm } from './notice.ts'

// Pi's code comes from the Ultimate clone's node_modules, as it does when the extension runs.
const root = process.env.ULTIMATE_ROOT
if (!root) throw new Error('Set ULTIMATE_ROOT to your Ultimate clone (it provides Pi)')
const collect = await loadCollect(root)
const models = { getModel: () => ({ cost: { cacheRead: 0.5 } }) }
const HOUR = 60 * 60_000

/** A Claude reply that read `read` tokens from the cache and wrote `write`, priced as Opus with a one-hour cache. */
function reply(id: number, at: number, read: number, write: number): Entry {
  const usage = {
    input: 2,
    output: 100,
    cacheRead: read,
    cacheWrite: write,
    cost: {
      input: 0,
      output: 0,
      cacheRead: read * 0.5e-6,
      cacheWrite: write * 10e-6,
      total: 0,
    },
  }
  return {
    id,
    kind: 'pi.assistant',
    model: [
      {
        role: 'assistant',
        provider: 'claude-code',
        model: 'opus',
        timestamp: at,
        usage,
      } as never,
    ],
  }
}
const input = (id: number): Entry => ({ id, kind: 'pi.user', input: true })

test('a rebuild after an idle gap is counted on the reply, its notice after the input that started it', () => {
  const entries = [
    input(1),
    reply(2, 0, 0, 170_000),
    input(3),
    { id: 4, kind: 'pi.system' },
    reply(5, 5 * HOUR, 0, 174_000),
  ]
  const [miss, ...rest] = missesOf(entries, [], collect, models)
  assert.equal(rest.length, 0)
  assert.equal(miss.reply, 5)
  assert.equal(miss.anchor, 3)
  assert.equal(miss.missedTokens, 170_002)
  assert.equal(miss.idleMs, 5 * HOUR)
  assert.ok(shown(miss))
  assert.equal(
    missText(miss),
    `Cache rebuilt after 5h 00m idle · 170k tokens · $${miss.missedCost.toFixed(2)}`,
  )
})

test('a keep-warm ping renews the cache: idle time runs from it, a miss it prevented is not counted', () => {
  const ping = (at: number): Warm => ({
    at,
    conversation: 1,
    model: 'opus',
    read: 170_000,
    write: 0,
  })
  const entries = [reply(1, 0, 0, 170_000), reply(2, 2 * HOUR, 170_000, 0)]
  assert.deepEqual(missesOf(entries, [ping(55 * 60_000), ping(110 * 60_000)], collect, models), [])
  const late = [reply(1, 0, 0, 170_000), reply(2, 3 * HOUR, 0, 170_000)]
  assert.equal(
    missesOf(late, [ping(55 * 60_000)], collect, models)[0].idleMs,
    3 * HOUR - 55 * 60_000,
  )
})

test('a ping before a compaction does not make the first reply after it a miss', () => {
  const ping: Warm = { at: HOUR, conversation: 1, model: 'opus', read: 170_000, write: 0 }
  const entries = [
    reply(1, 0, 0, 170_000),
    { id: 2, kind: 'pi.compaction' },
    reply(3, 2 * HOUR, 0, 20_000),
  ]
  assert.deepEqual(missesOf(entries, [ping], collect, models), [])
})

test("Pi's threshold: small misses stay quiet", () => {
  assert.equal(shown({ missedTokens: 19_999, missedCost: 0.09 }), false)
  assert.equal(shown({ missedTokens: 20_000, missedCost: 0 }), true)
  assert.equal(shown({ missedTokens: 5_000, missedCost: 0.1 }), true)
})

test('warm lines follow the reply before them; failed pings are not counted as warmed', () => {
  const replies = [
    { id: 10, at: 0 },
    { id: 20, at: 3 * HOUR },
  ]
  const warms: Warm[] = [
    { at: HOUR, conversation: 1, model: 'opus', cost: 0.05 },
    { at: 2 * HOUR, conversation: 1, model: 'opus', cost: 0.06 },
    { at: 2.5 * HOUR, conversation: 1, model: 'opus', error: 'rate limited' },
  ]
  assert.deepEqual(
    warms.map((warm) => warmAnchor(replies, warm)),
    [10, 10, 10],
  )
  assert.equal(warmText(warms), 'cache warmed 2× · $0.11')
  assert.equal(warmText(warms.slice(2)), undefined)
})
