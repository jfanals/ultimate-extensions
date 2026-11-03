/** The hold and release rule: `node --test ~/.ultimate/extensions/awake/awake.test.ts`. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAwake, onAC } from './awake.ts'

const GRACE = 120_000

function fake() {
  const holds: { stopped: boolean; die: () => void }[] = []
  const awake = createAwake((gone) => {
    const hold = {
      stopped: false,
      die: gone,
      stop: async () => {
        hold.stopped = true
      },
    }
    holds.push(hold)
    return hold
  }, GRACE)
  return { awake, holds }
}

test('one hold while agents work, released after the grace period', () => {
  const { awake, holds } = fake()
  awake.tick(0, 0)
  assert.equal(holds.length, 0)
  awake.tick(1, 1_000)
  awake.tick(3, 6_000)
  assert.equal(holds.length, 1)
  awake.tick(0, 10_000)
  awake.tick(0, 10_000 + GRACE - 1)
  assert.equal(holds[0].stopped, false)
  awake.tick(0, 10_000 + GRACE)
  assert.equal(holds[0].stopped, true)
  assert.equal(awake.held, false)
})

test('work within the grace period keeps the same hold', () => {
  const { awake, holds } = fake()
  awake.tick(1, 0)
  awake.tick(0, 1_000)
  awake.tick(2, 60_000)
  awake.tick(0, 61_000)
  awake.tick(0, 61_000 + GRACE - 1)
  assert.equal(holds.length, 1)
  assert.equal(holds[0].stopped, false)
  awake.tick(1, 61_000 + GRACE + 5_000)
  assert.equal(holds.length, 1)
})

test('close releases at once, and a later tick starts a fresh hold', async () => {
  const { awake, holds } = fake()
  awake.tick(1, 0)
  await awake.close()
  assert.equal(holds[0].stopped, true)
  awake.tick(1, 5_000)
  assert.equal(holds.length, 2)
})

test('close waits for an idle release still exiting', async () => {
  let exit = () => {}
  const awake = createAwake(
    () => ({ stop: () => new Promise<void>((resolve) => (exit = resolve)) }),
    GRACE,
  )
  awake.tick(1, 0)
  awake.tick(0, 1_000)
  awake.tick(0, 1_000 + GRACE)
  let closed = false
  const closing = awake.close().then(() => (closed = true))
  await Promise.resolve()
  assert.equal(closed, false)
  exit()
  await closing
  assert.equal(closed, true)
})

test('a hold that dies on its own is replaced on the next busy tick', () => {
  const { awake, holds } = fake()
  awake.tick(1, 0)
  holds[0].die()
  assert.equal(awake.held, false)
  awake.tick(1, 5_000)
  assert.equal(holds.length, 2)
  // A late exit of the old one does not drop the new one.
  holds[0].die()
  assert.equal(awake.held, true)
})

test('reads the power source from pmset', () => {
  assert.equal(onAC("Now drawing from 'AC Power'\n -InternalBattery-0 100%"), true)
  assert.equal(onAC("Now drawing from 'Battery Power'\n -InternalBattery-0 80%"), false)
})
