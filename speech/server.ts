import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { defineExtension } from '@earendil-works/pi-durable'
import { handleTranscription, WARM_ROUTE } from './transcription.ts'
import { createWorker } from './worker.ts'

/** The parts of `ExtensionHost` (`server/extensions.ts`) this facet uses. */
type Host = {
  userHome: string
  implement<S>(api: { name: string; service?: S }, value: S): void
  resource<T extends object>(key: string, create: () => T): T
  onClose(cleanup: () => Promise<void> | void): void
  notice(message: string): void
}

/** What other extensions call by name (`host.need({ name: 'speech' })`); Drive speaks through it. */
export type SpeechService = {
  /** The 24 kHz WAV of `text` in a Kokoro `voice`; empty text only loads the voice and returns no bytes. */
  speak(text: string, voice: string): Promise<Buffer>
  /** The text of the audio file at `path`, by Parakeet v3; an empty path only loads the model. */
  transcribe(path: string): Promise<string>
  /**
   * Start `engine` and load its model, or only restart its idle clock when it runs. Parakeet is warmed in the process
   * serving `speech.port`, the one transcription reaches; Kokoro in this one, where `speak` runs.
   */
  warm(engine: 'kokoro' | 'parakeet', voice?: string): Promise<void>
}
const SpeechApi: { name: 'speech'; service?: SpeechService } = { name: 'speech' }

type Settings = { python: string; idleMs: number; port: number }

/** `speech.python`, `speech.idleMinutes` and `speech.port` in `~/.ultimate/settings.json`. */
export async function settings(userHome: string): Promise<Settings> {
  // A missing or invalid settings file (reported where settings load) counts as unset here.
  const value: unknown = await readFile(join(userHome, '.ultimate/settings.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))
  const speech = (value as { speech?: { python?: unknown; idleMinutes?: unknown; port?: unknown } })
    ?.speech
  const minutes = speech?.idleMinutes
  const port = speech?.port
  return {
    python: typeof speech?.python === 'string' && speech.python ? speech.python : 'python3',
    idleMs: (typeof minutes === 'number' && minutes > 0 ? minutes : 15) * 60_000,
    port: Number.isInteger(port) && (port as number) > 0 ? (port as number) : 8179,
  }
}

const SCRIPTS = { kokoro: 'kokoro-speak.py', parakeet: 'parakeet-transcribe.py' }
type Engine = keyof typeof SCRIPTS

/** Starts `python script`, its stderr dropped: the protocol reports every failure on stdout. */
function spawnWorker(python: string, script: string) {
  const child = spawn(python, ['-I', join(import.meta.dirname, script)], {
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const exited = new Promise((resolve) => {
    child.once('exit', resolve)
    child.once('error', resolve)
  })
  return { stdin: child.stdin, stdout: child.stdout, kill: () => child.kill(), exited }
}

/** How often a process whose port another Ultimate holds tries to take it over, in case that one quit. */
const RETRY_MS = 30_000

export default function speechExtension(host: Host) {
  // Process state, kept across reloads: one worker per engine and command, and the HTTP server.
  const shared = host.resource('speech.state', () => {
    const state = {
      workers: new Map<string, ReturnType<typeof createWorker>>(),
      server: undefined as Server | undefined,
      port: undefined as number | undefined,
      retry: undefined as NodeJS.Timeout | undefined,
      handle: undefined as ((request: Request) => Promise<Response>) | undefined,
    }
    host.onClose(() => {
      for (const worker of state.workers.values()) worker.close()
      clearTimeout(state.retry)
      state.server?.close()
    })
    return state
  })

  /** The worker of `engine` for the current `speech.python`; a changed Python or script replaces it. */
  async function request(engine: Engine, body: object) {
    const { python, idleMs } = await settings(host.userHome)
    const key = `${engine}\0${python}\0${import.meta.dirname}`
    let worker = shared.workers.get(key)
    if (!worker) {
      for (const [old, stale] of shared.workers)
        if (old.startsWith(`${engine}\0`)) {
          stale.close()
          shared.workers.delete(old)
        }
      worker = createWorker(() => spawnWorker(python, SCRIPTS[engine]))
      shared.workers.set(key, worker)
    }
    return worker.request(body, idleMs)
  }

  const service: SpeechService = {
    speak: (text, voice) => request('kokoro', { text, voice }),
    transcribe: async (path) => (await request('parakeet', { path })).toString('utf8'),
    warm: async (engine, voice = 'af_heart') => {
      if (engine === 'kokoro') {
        await request('kokoro', { text: '', voice })
        return
      }
      const { port } = await settings(host.userHome)
      const response = await fetch(`http://127.0.0.1:${port}${WARM_ROUTE}`, { method: 'POST' })
      if (!response.ok) {
        // A body that is not JSON (another server on the port) falls back to the status.
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? `Speech warm-up failed: HTTP ${response.status}`)
      }
    },
  }
  host.implement(SpeechApi, service)

  // The server outlives reloads; each install points it at this facet's code.
  shared.handle = (incoming) => handleTranscription(incoming, (path) => service.transcribe(path))

  /** Serve `ROUTE` on 127.0.0.1:`speech.port`; another Ultimate on this Mac may hold it, so retry until it is free. */
  async function listen() {
    const { port } = await settings(host.userHome)
    if (shared.server && shared.port === port) return
    clearTimeout(shared.retry)
    shared.server?.close()
    shared.port = port
    const server = createServer(async (incoming, outgoing) => {
      try {
        const response = await shared.handle!(
          new Request(`http://127.0.0.1${incoming.url}`, {
            method: incoming.method,
            headers: incoming.headers as HeadersInit,
            body: incoming.method === 'POST' ? (Readable.toWeb(incoming) as ReadableStream) : null,
            // Node needs it for a streamed body; the DOM typings lack it.
            duplex: 'half',
          } as RequestInit),
        )
        outgoing.writeHead(response.status, Object.fromEntries(response.headers))
        outgoing.end(Buffer.from(await response.arrayBuffer()))
      } catch (error) {
        outgoing.writeHead(500, { 'content-type': 'application/json' })
        outgoing.end(JSON.stringify({ error: { message: String(error) } }))
      }
    })
    shared.server = server
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (shared.server !== server) return
      shared.server = undefined
      if (error.code !== 'EADDRINUSE')
        host.notice(`Speech could not serve port ${port}: ${error.message}`)
      shared.retry = setTimeout(serve, RETRY_MS)
      shared.retry.unref()
    })
    server.listen(port, '127.0.0.1')
  }
  const serve = () => {
    listen().catch((error: unknown) =>
      host.notice(`Speech could not start its server: ${String(error)}`),
    )
  }
  serve()

  return defineExtension({ name: 'speech' })
}
