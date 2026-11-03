import { spawn } from 'node:child_process'
import { mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension } from '@earendil-works/pi-durable'
import { tabStatus } from '../tab-status/status.ts'
import { ordered, rowState, STARTING_MS, startEnv } from './model.ts'
import type { Here, Overview, Row, Waiting } from './model.ts'

/** The parts of `ExtensionHost` (`server/extensions.ts`) this facet uses. */
type Host = {
  userHome: string
  ultimateRoot: string
  need<S>(api: { name: string; service?: S }): S
  projects(): Promise<
    {
      name: string
      root?: string
      current: boolean
      running?: { pid: number; url: string }
    }[]
  >
  conversations(): {
    id: number
    ownerTaskId?: number
    busy: boolean
    answerAt?: number
  }[]
  uiState(caller: unknown): Promise<Record<string, unknown>>
  doc(kind: string): unknown
  harness(): {
    snapshot(token: unknown, conversation: number, ctx: unknown): Promise<unknown>
  }
}
type Ctx = { host: Host; signal: AbortSignal }

// The messages service by name, as `messages/api.ts` defines it.
const MessagesApi: {
  name: 'messages'
  service?: { openQuestions(ctx: unknown): Promise<Waiting[]> }
} = { name: 'messages' }

/** How long another instance gets to answer before its row shows it as not answering. */
const ANSWER_MS = 5000

/** When Start ran, by root: a row shows starting until its instance holds its lock (this process only). */
const started = new Map<string, number>()

/** This instance's own status, by tab-status's rules, and the messages waiting on the user. */
async function here(host: Host): Promise<Here> {
  const overview = host.doc('ultimate.conversation-overview')
  const [waiting, ui, runs] = await Promise.all([
    host.need(MessagesApi).openQuestions(context),
    host.uiState(context),
    overview
      ? (host.harness().snapshot(overview, 1, context) as Promise<{
          conversations?: Record<string, { runState?: string }>
        } | null>)
      : undefined,
  ])
  const conversations = host.conversations()
  const status = tabStatus({
    conversations,
    runStates: Object.fromEntries(
      Object.entries(runs?.conversations ?? {}).map(([id, row]) => [id, row.runState]),
    ),
    waiting: waiting.length,
    seen: (ui['ext.conversations.seen'] ?? {}) as Record<string, number>,
    concluded: (ui['ext.conversations.concluded'] ?? []) as number[],
  })
  return { status, busy: conversations.filter((c) => c.busy).length, waiting }
}

/** Another instance's `here`, over loopback with its own origin, as every instance admits. */
async function ask(url: string, signal: AbortSignal): Promise<{ here: Here } | { error: string }> {
  try {
    const response = await fetch(`${url}/api/extensions/projects/actions/here`, {
      method: 'POST',
      headers: {
        Origin: new URL(url).origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ args: null }),
      signal: AbortSignal.any([AbortSignal.timeout(ANSWER_MS), signal]),
    })
    const body = (await response.json()) as { result?: Here; error?: string }
    return body.result ? { here: body.result } : { error: body.error ?? `HTTP ${response.status}` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** This instance's own `here`, failing into a row as another instance's does, within the same limit. */
async function local(host: Host): Promise<{ here: Here } | { error: string }> {
  try {
    return { here: await withTimeout(here(host), ANSWER_MS) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms).unref(),
    ),
  ])

/** Tailnet HTTPS ports by project root, from the tailscale extension's registry; none without it. */
async function tailnetPorts(host: Host): Promise<Record<string, number>> {
  // No registry (tailscale off) or an unreadable one: links then use loopback ports only.
  const registry = (await readFile(join(host.userHome, '.ultimate/tailscale.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))) as { ports?: Record<string, { port?: number }> }
  return Object.fromEntries(
    Object.entries(registry.ports ?? {}).flatMap(([root, entry]) =>
      typeof entry?.port === 'number' ? [[root, entry.port]] : [],
    ),
  )
}

export default defineExtension({ name: 'projects' })

export const pollActions = ['here', 'overview']
export const userActions = ['start']
export const actions = {
  /** No arguments → `Here`: this instance's status, for another instance's overview. */
  here: async (_args: unknown, { host }: Ctx) => here(host),
  /** No arguments → `Overview`: every project on this machine, each with its instance's answer. */
  overview: async (_args: unknown, { host, signal }: Ctx): Promise<Overview> => {
    const [projects, tailnet] = await Promise.all([host.projects(), tailnetPorts(host)])
    const now = Date.now()
    const rows = await Promise.all(
      projects
        .filter((project) => project.root)
        .map(async (project): Promise<Row> => {
          const root = project.root!
          if (project.running) started.delete(root)
          const answer = project.current
            ? await local(host)
            : project.running
              ? await ask(project.running.url, signal)
              : undefined
          return {
            name: project.name,
            root,
            current: project.current,
            ...rowState(!!project.running, answer, started.get(root), now),
            ...(project.running ? { port: Number(new URL(project.running.url).port) } : {}),
            ...(tailnet[root] === undefined ? {} : { tailnetPort: tailnet[root] }),
          }
        }),
    )
    return { at: now, rows: ordered(rows) }
  },
  /**
   * `{ root }` of a stopped project → `{ started }`: runs this clone's `bin/ultimate.ts <root> --no-open` on this
   * process's Node, detached, without this instance's ULTIMATE_* variables, logging to `~/.ultimate/logs/<name>.log`.
   * User-only.
   */
  start: async (args: unknown, { host }: Ctx) => {
    const root = (args as { root?: unknown } | null)?.root
    const project = (await host.projects()).find((item) => item.root === root)
    if (!project) throw new Error('Expected { root } of a project on this machine')
    if (project.running) throw new Error(`${project.name} is already running`)
    const at = started.get(project.root!)
    if (at !== undefined && Date.now() - at < STARTING_MS)
      throw new Error(`${project.name} is already starting`)
    // Reserved before any await, so a second click cannot launch it again; released if the launch fails.
    started.set(project.root!, Date.now())
    try {
      await launch(host, project as { name: string; root: string })
    } catch (error) {
      started.delete(project.root!)
      throw error
    }
    return { started: project.name }
  },
}

async function launch(host: Host, project: { name: string; root: string }) {
  const logs = join(host.userHome, '.ultimate/logs')
  await mkdir(logs, { recursive: true })
  const log = await open(join(logs, `${project.name.toLowerCase()}.log`), 'a')
  try {
    const bin = join(host.ultimateRoot, 'bin/ultimate.ts')
    const child = spawn(process.execPath, [bin, project.root, '--no-open'], {
      cwd: project.root,
      detached: true,
      env: startEnv(process.env),
      stdio: ['ignore', log.fd, log.fd],
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
  } finally {
    await log.close()
  }
}
