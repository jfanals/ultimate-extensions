/** Classify answered through Pi's runtime: `node --test jev-openrouter/adapter.test.ts`. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modelId, openRouterClassify, provider } from './adapter.ts'
import type { Runtime } from './adapter.ts'

const model = { id: modelId, provider, type: 'classifier' } as never
const questions = {
  done: { type: 'noul', instructions: 'Finished?' },
  mood: { type: 'score', instructions: 'How positive?', criteria: ['negative', 'positive'] },
}
const request = { state: { message: 'Landed.' }, questions } as never
// OpenRouter's System One answers, and what Pi makes of them.
const wire = {
  done: { type: 'noul', noul: 0.79 },
  mood: {
    type: 'score',
    score: 0.98,
    confidence: 0.97,
    probabilities: { 0: 0.02, 1: 0.98 },
    legend: { 0: 'negative', 1: 'positive' },
  },
}
const parsed = {
  done: { type: 'bool', probability: 0.79 },
  mood: { type: 'score', score: 0.98, confidence: 0.97 },
}

/** A runtime that, like Pi's, posts through the fetch it is given and then returns `result`. */
function runtime(result: object, found = true) {
  const calls: unknown[][] = []
  const fake: Runtime = {
    getModelOfType: (...args) => {
      calls.push(['model', ...args])
      return found ? model : undefined
    },
    classify: async (...args) => {
      calls.push(['classify', args[0], args[1]])
      await args[2].fetch('https://openrouter.test/systemone', { method: 'POST' })
      return { model: modelId, answers: parsed, stopReason: 'stop', ...result } as never
    },
  }
  return { fake, calls }
}
const respond = (status: number) => async () => Response.json({ answers: wire }, { status })
const signal = new AbortController().signal

test('asks Jev on OpenRouter and returns classify’s own answers: noul, and score with probabilities and legend', async () => {
  const { fake, calls } = runtime({ usage: { input: 312 } })
  const result = await openRouterClassify(fake, respond(200)).ask(request, signal)
  assert.deepEqual(result, { model: modelId, answers: wire, usage: { inputTokens: 312 } })
  assert.deepEqual(calls, [
    ['model', 'classifier', 'openrouter', 'typesafe/jev-1.14'],
    ['classify', model, { state: { message: 'Landed.' }, questions }],
  ])
})

test('an error result throws its message, so callers fail and messages reports', async () => {
  const failed = runtime({ stopReason: 'error', errorMessage: 'System One API returned 401' })
  await assert.rejects(openRouterClassify(failed.fake, respond(401)).ask(request, signal), {
    message: 'System One API returned 401',
  })
  const aborted = runtime({ stopReason: 'aborted' })
  await assert.rejects(openRouterClassify(aborted.fake, respond(200)).ask(request, signal), {
    message: 'aborted',
  })
})

test('throws when Pi has no such model', async () => {
  const { fake, calls } = runtime({}, false)
  await assert.rejects(openRouterClassify(fake, respond(200)).ask(request, signal), {
    message: "openrouter/typesafe/jev-1.14 is not in Pi's model catalogue",
  })
  assert.equal(calls.length, 1)
})
