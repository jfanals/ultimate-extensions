/**
 * The speech workers' core paths, outside the clone's suites: `node --test ~/.ultimate/extensions/speech/speech.test.ts`.
 * The real engines (Kokoro, Parakeet) are checked on the running host.
 */
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { handleTranscription, ROUTE, WARM_ROUTE } from './transcription.ts'
import { createWorker } from './worker.ts'

/** A fake worker script: answers each request line with what `answer` returns, written in odd-sized chunks. */
function fakeWorker(answer: (request: { text: string }) => Buffer | string) {
  const started: { requests: string[]; killed: boolean; exit: () => void }[] = []
  const start = () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const exit = Promise.withResolvers<void>()
    const worker = { requests: [] as string[], killed: false, exit: () => exit.resolve() }
    started.push(worker)
    let pending = ''
    stdin.on('data', (chunk: Buffer) => {
      pending += chunk.toString()
      for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
        const line = pending.slice(0, at)
        pending = pending.slice(at + 1)
        worker.requests.push(line)
        const reply = answer(JSON.parse(line))
        const bytes = typeof reply === 'string' ? Buffer.from(reply) : reply
        // Split mid-header and mid-body: the reader must reassemble both.
        stdout.write(bytes.subarray(0, 3))
        stdout.write(bytes.subarray(3))
      }
    })
    void exit.promise.then(() => stdout.end())
    const kill = () => {
      worker.killed = true
      exit.resolve()
    }
    return { stdin, stdout, kill, exited: exit.promise }
  }
  return { start, started }
}
const framed = (text: string) =>
  Buffer.concat([Buffer.from(`{"bytes": ${Buffer.byteLength(text)}}\n`), Buffer.from(text)])
const tick = () => new Promise((resolve) => setImmediate(resolve))
const IDLE = 60_000

test('answers through one warm worker, one request at a time, and restarts it after it exits', async () => {
  const fake = fakeWorker(({ text }) =>
    text === 'boom' ? '{"error": "no voice"}\n' : framed(`said:${text}`),
  )
  const worker = createWorker(fake.start)
  const [one, two] = await Promise.all([
    worker.request({ text: 'Hello there.' }, IDLE),
    worker.request({ text: 'Second.' }, IDLE),
  ])
  assert.deepEqual([one.toString(), two.toString()], ['said:Hello there.', 'said:Second.'])
  await assert.rejects(worker.request({ text: 'boom' }, IDLE), /no voice/)
  assert.equal(fake.started.length, 1)

  fake.started[0].exit()
  // Once the old worker's pipes have closed, the next request starts a new one.
  await tick()
  assert.equal((await worker.request({ text: 'Again.' }, IDLE)).toString(), 'said:Again.')
  assert.equal(fake.started.length, 2)
  worker.close()
  assert.equal(fake.started[1].killed, true)
})

test('stops the worker once it has been idle, and starts it again on the next request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fake = fakeWorker(({ text }) => framed(text))
  const worker = createWorker(fake.start)
  await worker.request({ text: 'One.' }, IDLE)
  t.mock.timers.tick(IDLE - 1)
  // A request before the deadline restarts the clock.
  await worker.request({ text: 'Two.' }, IDLE)
  t.mock.timers.tick(IDLE - 1)
  assert.equal(fake.started[0].killed, false)
  t.mock.timers.tick(1)
  assert.equal(fake.started[0].killed, true)
  assert.equal(worker.running, false)
  assert.equal((await worker.request({ text: 'Three.' }, IDLE)).toString(), 'Three.')
  assert.equal(fake.started.length, 2)
  worker.close()
})

test('a warm-up queues behind a real request on the same worker and restarts its idle clock', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  // The empty request is a warm-up: the script loads its model and answers no bytes.
  const fake = fakeWorker(({ text }) => framed(text))
  const worker = createWorker(fake.start)
  const [real, warm] = await Promise.all([
    worker.request({ text: 'Hello.' }, IDLE),
    worker.request({ text: '' }, IDLE),
  ])
  assert.deepEqual([real.toString(), warm.length], ['Hello.', 0])
  assert.deepEqual(fake.started[0].requests, ['{"text":"Hello."}', '{"text":""}'])
  // Keep-alives every minute hold the worker past its idle time; it stops once they end.
  for (let minute = 0; minute < 5; minute++) {
    t.mock.timers.tick(IDLE - 1)
    await worker.request({ text: '' }, IDLE)
  }
  assert.equal(fake.started.length, 1)
  assert.equal(fake.started[0].killed, false)
  t.mock.timers.tick(IDLE)
  assert.equal(fake.started[0].killed, true)
})

test('starts no worker for requests still queued when the worker is closed', async () => {
  // The first request hangs, so the second is still queued when the worker closes.
  const fake = fakeWorker(({ text }) => (text === 'One.' ? '' : framed(text)))
  const worker = createWorker(fake.start)
  const first = worker.request({ text: 'One.' }, IDLE)
  const queued = worker.request({ text: 'Two.' }, IDLE)
  await tick()
  worker.close()
  // The hung request fails when its worker is killed; only the queued one is under test.
  await first.catch(() => undefined)
  await assert.rejects(queued, /replaced/)
  assert.equal(fake.started.length, 1)
})

test('fails a request when the worker dies mid-answer, and replaces it on garbage', async () => {
  let mode = 'die'
  const fake = fakeWorker(() => (mode === 'die' ? '{"bytes": 100}\nRIFF' : 'not json\n'))
  const worker = createWorker(fake.start)
  const dying = worker.request({ text: 'Hi.' }, IDLE)
  await tick()
  fake.started[0].exit()
  await assert.rejects(dying, /The speech worker stopped/)
  mode = 'garbage'
  await assert.rejects(worker.request({ text: 'Hi.' }, IDLE), /garbage/)
  assert.equal(fake.started[1].killed, true)
})

test('serves OpenAI-style transcription of an uploaded file', async () => {
  const form = new FormData()
  form.set('file', new Blob(['opus'], { type: 'audio/webm' }), 'recording.webm')
  form.set('model', 'gpt-4o-mini-transcribe')
  let seen = ''
  const response = await handleTranscription(
    new Request(`http://127.0.0.1${ROUTE}`, { method: 'POST', body: form }),
    async (path) => {
      seen = path
      return 'Hola.'
    },
  )
  assert.deepEqual(await response.json(), { text: 'Hola.' })
  assert.match(seen, /\.webm$/)
  const failed = await handleTranscription(
    new Request(`http://127.0.0.1${ROUTE}`, { method: 'POST', body: form }),
    async () => {
      throw new Error('not installed')
    },
  )
  assert.equal(failed.status, 500)
  assert.deepEqual(await failed.json(), { error: { message: 'not installed' } })
})

test('warms speech to text without audio', async () => {
  const paths: string[] = []
  const response = await handleTranscription(
    new Request(`http://127.0.0.1${WARM_ROUTE}`, { method: 'POST' }),
    async (path) => {
      paths.push(path)
      return ''
    },
  )
  assert.equal(response.status, 200)
  assert.deepEqual(paths, [''])
})
