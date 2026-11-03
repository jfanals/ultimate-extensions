/** The tab status's priority, outside the clone's suites: `node --test ~/.ultimate/extensions/tab-status/status.test.ts`. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { offerBadge, prefixed, tabStatus } from './status.ts'
import type { StatusInput } from './status.ts'

const base: StatusInput = {
  conversations: [
    { id: 2, busy: false, answerAt: 10 },
    { id: 3, busy: false, answerAt: 10 },
    { id: 4, ownerTaskId: 7, busy: false, answerAt: 10 },
  ],
  runStates: {},
  waiting: 0,
  seen: { 2: 10, 3: 10 },
  concluded: [],
}

test('needs you, then failed, then working, then a new answer', () => {
  const all: StatusInput = {
    ...base,
    waiting: 1,
    runStates: { 2: 'error', 4: 'working' },
    seen: { 2: 10, 3: 5 },
  }
  assert.equal(tabStatus(all), 'needs-you')
  assert.equal(tabStatus({ ...all, waiting: 0 }), 'failed')
  assert.equal(tabStatus({ ...all, waiting: 0, runStates: { 4: 'working' } }), 'working')
  assert.equal(tabStatus({ ...all, waiting: 0, runStates: {} }), 'answer')
  assert.equal(tabStatus(base), 'idle')
})

test('a subagent failing or a concluded branch failing does not mark the tab, an answer on screen is seen', () => {
  assert.equal(tabStatus({ ...base, runStates: { 4: 'error' } }), 'idle')
  assert.equal(tabStatus({ ...base, runStates: { 3: 'error' }, concluded: [3] }), 'idle')
  assert.equal(tabStatus({ ...base, seen: { 2: 10, 3: 5 }, shown: 3 }), 'idle')
})

test('the Dock badge offer shows only while permission is undecided and badging exists', () => {
  assert.equal(offerBadge('default', true), true)
  assert.equal(offerBadge('granted', true), false)
  assert.equal(offerBadge('denied', true), false)
  assert.equal(offerBadge('default', false), false)
  assert.equal(offerBadge(undefined, true), false)
})

test('the prefix replaces the core busy dot and an earlier status', () => {
  assert.equal(prefixed('● my-app · Fix', 'needs-you'), '🟡 my-app · Fix')
  assert.equal(prefixed('🟣 my-app', 'answer'), '🟢 my-app')
  assert.equal(prefixed('🟣 my-app', 'idle'), 'my-app')
})
