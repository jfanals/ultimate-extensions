/** Classify answered through Pi's runtime: `node --test classify-openrouter/adapter.test.ts`. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaults, modelsOf, openRouterClassify, provider } from './adapter.ts'
import type { Runtime } from './adapter.ts'

const jev = defaults.model

test('the setting picks each model; unset ones keep Jev for classify and Microsoft for the judge', () => {
  assert.deepEqual(modelsOf(undefined), {
    model: 'typesafe/jev-1.14',
    judge: 'microsoft/microsoft-decision-1.1',
  })
  assert.deepEqual(modelsOf({ judge: 'typesafe/jev-1.14' }), {
    model: 'typesafe/jev-1.14',
    judge: 'typesafe/jev-1.14',
  })
  assert.throws(() => modelsOf({ model: 7 }), /OpenRouter model ids/)
  assert.throws(() => modelsOf('typesafe/jev-1.14'), /must be an object/)
})

const model = { id: jev, provider, type: 'classifier' } as never
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

/** A runtime that, like Pi's, posts the payload `onPayload` makes through the fetch it is given, then returns `result`. */
function runtime(result: object, found = true) {
  const calls: unknown[][] = []
  const fake: Runtime = {
    getModelOfType: (...args) => {
      calls.push(['model', ...args])
      return found ? model : undefined
    },
    classify: async (...args) => {
      calls.push(['classify', args[0], args[1]])
      const body = args[2].onPayload({ model: jev, ...args[1] })
      calls.push(['post', body])
      await args[2].fetch('https://openrouter.test/systemone', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return { model: jev, answers: parsed, stopReason: 'stop', ...result } as never
    },
  }
  return { fake, calls }
}
const respond = (status: number) => async () => Response.json({ answers: wire }, { status })
const signal = new AbortController().signal

test('asks Jev on OpenRouter, zero data retention only, and returns classify’s own answers: noul, and score with probabilities and legend', async () => {
  const { fake, calls } = runtime({ usage: { input: 312 } })
  const result = await openRouterClassify(fake, jev, respond(200)).ask(request, signal)
  assert.deepEqual(result, { model: jev, answers: wire, usage: { inputTokens: 312 } })
  assert.deepEqual(calls, [
    ['model', 'classifier', 'openrouter', 'typesafe/jev-1.14'],
    ['classify', model, { state: { message: 'Landed.' }, questions }],
    ['post', { model: jev, state: { message: 'Landed.' }, questions, provider: { zdr: true } }],
  ])
})

test('an error result throws its message, so callers fail and messages reports', async () => {
  const failed = runtime({ stopReason: 'error', errorMessage: 'System One API returned 401' })
  await assert.rejects(openRouterClassify(failed.fake, jev, respond(401)).ask(request, signal), {
    message: 'System One API returned 401',
  })
  const aborted = runtime({ stopReason: 'aborted' })
  await assert.rejects(openRouterClassify(aborted.fake, jev, respond(200)).ask(request, signal), {
    message: 'aborted',
  })
})

test('throws when Pi has no such model', async () => {
  const { fake, calls } = runtime({}, false)
  await assert.rejects(openRouterClassify(fake, jev, respond(200)).ask(request, signal), {
    message: "openrouter/typesafe/jev-1.14 is not in Pi's model catalogue",
  })
  assert.equal(calls.length, 1)
})
