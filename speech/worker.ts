import type { Readable, Writable } from 'node:stream'

/** A started worker process: its pipes, how to stop it, and when it exits. */
export type Process = {
  stdin: Writable
  stdout: Readable
  kill(): void
  exited: Promise<unknown>
}

/**
 * One on-demand speech worker (`parakeet-transcribe.py`, `kokoro-speak.py`): started by the first request, kept warm,
 * and killed `idleMs` after its last answer. Requests run one at a time: each writes a JSON line and reads back a
 * `{"bytes": N}` header line and N bytes, or `{"error": "..."}`.
 */
export function createWorker(start: () => Process, timeoutMs = 120_000) {
  let worker: { process: Process; read: (count: number | 'line') => Promise<Buffer> } | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let idle: NodeJS.Timeout | undefined
  let closed = false

  function open() {
    const process = start()
    let buffered = Buffer.alloc(0)
    let ended: Error | undefined
    let wake: (() => void) | undefined
    process.stdout.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      wake?.()
    })
    const stop = (error: Error) => {
      ended ??= error
      if (worker?.process === process) worker = undefined
      wake?.()
    }
    process.stdout.on('end', () => stop(new Error('The speech worker stopped')))
    process.stdout.on('error', stop)
    process.stdin.on('error', stop)
    // oxlint-disable-next-line typescript/no-floating-promises -- `exited` never rejects; it only marks the end.
    void process.exited.then(() => stop(new Error('The speech worker stopped')))
    /** The next line (without its newline) or the next `count` bytes, as they arrive. */
    async function read(count: number | 'line'): Promise<Buffer> {
      for (;;) {
        const end = count === 'line' ? buffered.indexOf(10) : count <= buffered.length ? count : -1
        if (end >= 0) {
          const taken = buffered.subarray(0, end)
          buffered = buffered.subarray(count === 'line' ? end + 1 : end)
          return taken
        }
        if (ended) throw ended
        await new Promise<void>((resolve) => (wake = resolve))
        wake = undefined
      }
    }
    return { process, read }
  }

  async function run(request: object, idleMs: number) {
    // A closed worker never starts again: nothing would ever stop it.
    if (closed) throw new Error('The speech worker was replaced')
    clearTimeout(idle)
    worker ??= open()
    const { process, read } = worker
    process.stdin.write(`${JSON.stringify(request)}\n`)
    // A worker that stops answering (a stuck model load) is killed, which fails this request and frees the queue.
    const timer = setTimeout(() => process.kill(), timeoutMs)
    try {
      let header: { bytes?: unknown; error?: unknown }
      try {
        header = JSON.parse((await read('line')).toString('utf8'))
      } catch (error) {
        // Out of step with the protocol: start a fresh worker next time.
        process.kill()
        throw error instanceof SyntaxError ? new Error('The speech worker answered garbage') : error
      }
      if (typeof header.error === 'string') throw new Error(header.error)
      if (typeof header.bytes !== 'number') throw new Error('The speech worker answered garbage')
      return Buffer.from(await read(header.bytes))
    } finally {
      clearTimeout(timer)
      // The idle clock runs from the last answer; the next request clears it.
      idle = setTimeout(() => {
        if (worker?.process === process) worker = undefined
        process.kill()
      }, idleMs)
      idle.unref()
    }
  }

  return {
    /** The answer's bytes; the worker stops `idleMs` after the last answer unless another request comes first. */
    request(request: object, idleMs: number): Promise<Buffer> {
      const result = queue.then(() => run(request, idleMs))
      // The queue only orders requests; each caller sees its own failure.
      queue = result.catch(() => undefined)
      return result
    },
    /** Whether a worker process is running now. */
    get running() {
      return worker !== undefined
    },
    close() {
      closed = true
      clearTimeout(idle)
      worker?.process.kill()
      worker = undefined
    },
  }
}
