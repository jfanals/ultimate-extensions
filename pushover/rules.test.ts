/** What a notification says, batching and presence: `node --test pushover/rules.test.ts`. */
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import {
  asker,
  batched,
  gather,
  landingNote,
  present,
  questionNote,
  reportNote,
  WINDOW_MS,
} from './rules.ts'
import type { Message } from './rules.ts'

const ORIGIN = 'https://mac.example.ts.net:4747'

const question: Message = {
  id: 42,
  from: 7,
  to: 'user',
  reply: true,
  text: 'Two decisions before I build.',
  questions: [
    {
      text: 'Which opening next?',
      ref: '1',
      options: [
        { key: 'a', label: 'Italian', recommended: true },
        { key: 'b', label: 'Sicilian' },
      ],
    },
    { text: 'Daily or weekly?', ref: '2' },
  ],
}

test('a question names project and asker, its first question and recommended pick, and opens the Inbox', () => {
  assert.deepEqual(
    questionNote('chess', question, asker(7, { ultimate: 3 }, 'Opening drills'), ORIGIN),
    {
      title: 'chess · Opening drills asks',
      message: 'Which opening next? → recommended: 1a Italian (+1 more)',
      url: `${ORIGIN}/?inbox=42`,
      url_title: 'Open in Inbox',
    },
  )
})

test('a standing agent asks as @name, an untitled branch as #id', () => {
  assert.equal(asker(9, { ultimate: 3, 'chess-coach': 9 }, 'Coach'), '@chess-coach')
  assert.equal(asker(7, { ultimate: 3 }, undefined), '#7')
})

test('a question without question cards says its first line', () => {
  const plain = { ...question, questions: undefined, text: '\n**Ready to land?** It passed.' }
  assert.equal(questionNote('chess', plain, '#7', ORIGIN)?.message, 'Ready to land? It passed.')
})

test("@ultimate's no-reply message is a report with its bold lead; other messages are not", () => {
  const report: Message = {
    id: 50,
    from: 3,
    to: 'user',
    reply: false,
    text: '**Shipped the board.** Details…',
  }
  assert.deepEqual(reportNote('chess', report, 3, ORIGIN), {
    title: 'chess · done',
    message: 'Shipped the board.',
    url: `${ORIGIN}/?conversation=3`,
    url_title: 'Open conversation',
    ttl: 86_400,
  })
  const plain = {
    ...report,
    text: 'Fixed `read` filling; see [org/app#158](https://example.com/158).',
  }
  assert.equal(
    reportNote('chess', plain, 3, ORIGIN)?.message,
    'Fixed read filling; see org/app#158.',
  )
  assert.equal(reportNote('chess', { ...report, from: 7 }, 3, ORIGIN), undefined)
  assert.equal(reportNote('chess', { ...report, reply: true }, 3, ORIGIN), undefined)
  assert.equal(questionNote('chess', report, '@ultimate', ORIGIN), undefined)
})

test('a landing says its title and expires after a day', () => {
  const note = landingNote(
    'chess',
    { title: 'Board: Drag to Move (#12)', conversationId: 12 },
    ORIGIN,
  )
  assert.equal(note.title, 'chess · landed')
  assert.equal(note.message, 'Board: Drag to Move (#12)')
  assert.equal(note.url, `${ORIGIN}/?conversation=12`)
  assert.equal(note.ttl, 86_400)
})

test('questions of one window become one notification listing them, linking to the Inbox', () => {
  const one = questionNote('chess', question, '#7', ORIGIN)!
  assert.equal(batched('chess', [], ORIGIN), undefined)
  assert.equal(batched('chess', [one], ORIGIN), one)
  const many = batched('chess', [one, one, one], ORIGIN)!
  assert.equal(many.title, '3 questions waiting in chess')
  assert.equal(many.message.split('\n').length, 3)
  assert.equal(many.url, `${ORIGIN}/?inbox=`)
})

test('questions within a minute of the first go out together once; a repeated one counts once', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const sent: number[][] = []
    const window = gather<number>((items) => sent.push(items))
    window.add(1, 1)
    mock.timers.tick(30_000)
    window.add(2, 2)
    window.add(2, 2)
    window.add(3, 3)
    assert.deepEqual(sent, [])
    mock.timers.tick(WINDOW_MS - 30_000)
    assert.deepEqual(sent, [[1, 2, 3]])
    window.add(4, 4)
    mock.timers.tick(WINDOW_MS)
    assert.deepEqual(sent, [[1, 2, 3], [4]])
  } finally {
    mock.timers.reset()
  }
})

test('a page reported in the last minute counts as present', () => {
  assert.equal(present(undefined, 100_000), false)
  assert.equal(present(41_000, 100_000), true)
  assert.equal(present(40_000, 100_000), false)
})
