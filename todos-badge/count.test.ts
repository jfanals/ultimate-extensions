/** The badge's count, outside the clone's suites: `node --test ~/.ultimate/extensions/todos-badge/count.test.ts`. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { title, waiting } from './count.ts'

test('counts open questions to the user and their open to-dos, never @ultimate’s', () => {
  const messages = [
    { to: 'user' as const, reply: true, state: 'delivered' },
    { to: 'user' as const, reply: true, state: 'answered' },
    { to: 'user' as const, reply: false, state: 'delivered' },
    { to: 4, reply: true, state: 'delivered' },
  ]
  const todos = [
    { owner: 'user' as const },
    { owner: 'user' as const, done: 5 },
    { owner: 'ultimate' as const },
  ]
  assert.deepEqual(waiting(messages, todos), { questions: 1, todos: 1 })
  assert.deepEqual(waiting([], []), { questions: 0, todos: 0 })
})

test('the tooltip names what waits', () => {
  assert.equal(title({ questions: 2, todos: 1 }), '2 questions · 1 to-do for you')
  assert.equal(title({ questions: 1, todos: 0 }), '1 question for you')
  assert.equal(title({ questions: 0, todos: 3 }), '3 to-dos for you')
})
