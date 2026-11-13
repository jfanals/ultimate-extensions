import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  elsewhereItems,
  groups,
  ordered,
  projectUrl,
  rowState,
  STARTING_MS,
  startEnv,
  totals,
} from './model.ts'
import type { Row } from './model.ts'

const row = (
  name: string,
  waiting: number[],
  state: Row['state'] = 'idle',
  current = false,
): Row => ({
  name,
  root: `/src/${name}`,
  current,
  state,
  busy: 0,
  waiting: waiting.map((at, index) => ({
    message: index + 1,
    conversation: 7,
    at,
    text: `${name} ${at}`,
  })),
})

test('totals count waiting messages, their projects and the working ones', () => {
  const sum = totals([
    row('a', [30, 10], 'needs-you'),
    row('b', []),
    row('c', [20], 'needs-you'),
    { ...row('d', [], 'working'), busy: 2 },
  ])
  assert.equal(sum.waiting, 3)
  assert.equal(sum.projects, 2)
  assert.equal(sum.working, 1)
})

test('questions group by project, oldest first in each, the project waiting longest first', () => {
  const grouped = groups([row('a', [30, 25]), row('b', []), row('c', [20, 40])])
  assert.deepEqual(
    grouped.map((group) => [group.row.name, group.questions.map((question) => question.at)]),
    [
      ['c', [20, 40]],
      ['a', [25, 30]],
    ],
  )
})

test("the Inbox gets every other project's questions, keyed by project and message, and none of this one's", () => {
  const items = elsewhereItems([
    row('here', [5], 'needs-you', true),
    row('b', [30]),
    row('c', [10, 40]),
  ])
  assert.deepEqual(
    items.map((item) => [item.key, item.question.at]),
    [
      ['projects:b:1', 30],
      ['projects:c:1', 10],
      ['projects:c:2', 40],
    ],
  )
})

test("a row's state: the instance's own status, else stopped, starting or not answering", () => {
  const here = { status: 'working' as const, busy: 2, waiting: [] }
  assert.equal(rowState(true, { here }, undefined, 0).state, 'working')
  assert.equal(rowState(true, { error: 'timeout' }, undefined, 0).state, 'unreachable')
  assert.equal(rowState(false, undefined, undefined, 0).state, 'stopped')
  assert.equal(rowState(false, undefined, 1000, 1000 + STARTING_MS - 1).state, 'starting')
  assert.equal(rowState(false, undefined, 1000, 1000 + STARTING_MS).state, 'stopped')
})

test('the current project comes first, then by name', () => {
  const rows = ordered([row('car', []), row('ultimate', [], 'idle', true), row('my-app', [])])
  assert.deepEqual(
    rows.map((item) => item.name),
    ['ultimate', 'car', 'my-app'],
  )
})

test("a question opens in its project's Inbox, on the tailnet port over HTTPS, else on its local port", () => {
  const ports = { port: 5048, tailnetPort: 5049 }
  assert.equal(
    projectUrl({ protocol: 'http:', hostname: 'localhost' }, ports, 7),
    'http://localhost:5048/?inbox=7',
  )
  assert.equal(
    projectUrl({ protocol: 'https:', hostname: 'laptop.example.com' }, ports, 7),
    'https://laptop.example.com:5049/?inbox=7',
  )
  assert.equal(
    projectUrl({ protocol: 'https:', hostname: 'laptop.example.com' }, ports),
    'https://laptop.example.com:5049/#projects-open',
  )
  assert.equal(
    projectUrl({ protocol: 'https:', hostname: 'laptop.example.com' }, { port: 5051 }),
    undefined,
  )
})

test("a started project does not inherit this instance's home or port", () => {
  assert.deepEqual(
    startEnv({
      PATH: '/bin',
      ULTIMATE_HOME: '/h',
      ULTIMATE_PORT: '1',
      ULTIMATE_PROJECT: '/p',
    }),
    {
      PATH: '/bin',
    },
  )
})
