/** The threshold rule: `node --test dream-defaults/defaults.test.ts`. Applying it is checked on a throwaway project. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BUILT_INS, decide, defaultsOf } from './defaults.ts'

const [before, pause] = BUILT_INS
const defaults = { beforeCompaction: 22, afterPause: 20 }
const at = (above: number, enabled = true) => ({ enabled, condition: { above } })

test('a built-in still at upstream’s threshold gets the user’s', () => {
  assert.equal(decide(before, defaults, at(70), undefined), 22)
  assert.equal(decide(pause, defaults, at(50), { builtInPause: { enabled: true } }), 20)
})

test('waits until dream made it; leaves an edit, a pause, a carried condition and an unset default', () => {
  assert.equal(decide(before, defaults, undefined, undefined), 'wait')
  assert.equal(decide(before, defaults, at(40), undefined), 'leave')
  assert.equal(decide(before, defaults, at(70, false), undefined), 'leave')
  const carried = {
    builtIn: { enabled: true, condition: { metric: 'context', of: '@ultimate', above: 70 } },
  }
  assert.equal(decide(before, defaults, at(70), carried), 'leave')
  assert.equal(decide(pause, { beforeCompaction: 22 }, at(50), undefined), 'leave')
})

test('a built-in its seed carried paused or deleted is left, even while dream has just made it enabled', () => {
  assert.equal(decide(pause, defaults, at(50), { builtInPause: { enabled: false } }), 'leave')
  assert.equal(decide(pause, defaults, undefined, { builtInPause: null }), 'leave')
})

test('settings keep whole percentages from 1 to 99', () => {
  assert.deepEqual(defaultsOf({ beforeCompaction: 22, afterPause: 20 }), defaults)
  assert.deepEqual(defaultsOf({ beforeCompaction: 0, afterPause: 20.5, other: 3 }), undefined)
  assert.deepEqual(defaultsOf({ afterPause: 99 }), { afterPause: 99 })
  assert.equal(defaultsOf(undefined), undefined)
})
