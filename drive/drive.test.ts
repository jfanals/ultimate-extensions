/**
 * The Drive screen's core paths, outside the clone's suites: `node --test ~/.ultimate/extensions/drive/drive.test.ts`.
 * The `ask` action (a spoken input to @ultimate, a spoken answer to a question) is checked on the running host; the
 * speech workers are tested in the speech extension.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageSpeech, plain, sentences } from './speech.ts'

test('reads Markdown and questions as plain sentences', () => {
  assert.equal(
    plain('**Done.** See `extensions/drive` and [the PR](https://x.test/1).\n- one\n- two'),
    'Done. See extensions/drive and the PR. one. two',
  )
  assert.equal(
    messageSpeech(
      {
        id: 3,
        from: 5,
        to: 'user',
        text: 'Pick one.',
        reply: true,
        state: 'delivered',
        questions: [
          {
            text: 'Which way?',
            kind: 'choice',
            ref: '1',
            options: [{ label: 'Fast' }, { label: 'Safe' }],
          },
        ],
      },
      'Drive screen',
    ),
    'Drive screen says: Pick one. Question 1: Which way? Option 1: Fast. Option 2: Safe.',
  )
  const pieces = sentences(`${'word '.repeat(80)}end. Short one. And another.`)
  assert.ok(pieces.every((piece) => piece.length <= 240))
  assert.equal(pieces.at(-1), 'Short one. And another.')
})
