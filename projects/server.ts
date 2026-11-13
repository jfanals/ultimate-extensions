import { execFile, spawn } from 'node:child_process'
import { mkdir, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { promisify } from 'node:util'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension } from '@earendil-works/pi-durable'
import { tabStatus } from '../tab-status/status.ts'
import {
  defaultRoots,
  ordered,
  rowState,
  STARTING_MS,
  STOPPING_MS,
  startEnv,
  validName,
} from './model.ts'
import type { Folder, Folders, Here, Overview, Question, Row, Waiting } from './model.ts'

const run = promisify(execFile)

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
/** When Stop ran, by root: a row shows stopping until its instance lets go of its lock (this process only). */
const stopping = new Map<string, number>()

/** The Messages log's fields a waiting question shows in another project's Inbox. */
type Log = {
  messages: {
    id: number
    text: string
    questions?: Question[]
    images?: { count: number }
  }[]
}

/** This instance's own status, by tab-status's rules, and the messages waiting on the user, whole. */
async function here(host: Host): Promise<Here> {
  const overview = host.doc('ultimate.conversation-overview')
  // The Messages log by kind, as `messages/refs.ts` `MessagesDoc` names it.
  const board = host.doc('board')
  const [asked, ui, runs, log] = await Promise.all([
    host.need(MessagesApi).openQuestions(context),
    host.uiState(context),
    overview
      ? (host.harness().snapshot(overview, 1, context) as Promise<{
          conversations?: Record<string, { runState?: string }>
        } | null>)
      : undefined,
    board ? (host.harness().snapshot(board, 1, context) as Promise<Log | null>) : undefined,
  ])
  const waiting = asked.map((item): Waiting => {
    const message = log?.messages.find((candidate) => candidate.id === item.message)
    if (!message) return item
    return {
      ...item,
      text: message.text,
      ...(message.questions?.length ? { questions: message.questions } : {}),
      ...(message.images?.count ? { images: message.images.count } : {}),
    }
  })
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
export const userActions = ['start', 'stop', 'open', 'create', 'hide', 'unhide']
export const actions = {
  /** No arguments → `Here`: this instance's status, for another instance's overview. */
  here: async (_args: unknown, { host }: Ctx) => here(host),
  /** No arguments → `Overview`: every project on this machine, each with its instance's answer. */
  overview: async (_args: unknown, { host, signal }: Ctx): Promise<Overview> => {
    const [projects, tailnet, hiddenRoots] = await Promise.all([
      host.projects(),
      tailnetPorts(host),
      hiddenList(host),
    ])
    const now = Date.now()
    // A hidden project shows again while it runs or starts, whoever started it.
    const hide = (project: { root?: string; running?: unknown }) =>
      hiddenRoots.includes(project.root!) && !project.running && !started.has(project.root!)
    const rows = await Promise.all(
      projects
        .filter((project) => project.root && !hide(project))
        .map(async (project): Promise<Row> => {
          const root = project.root!
          if (project.running) started.delete(root)
          else stopping.delete(root)
          const answer = project.current
            ? await local(host)
            : project.running
              ? await ask(project.running.url, signal)
              : undefined
          return {
            name: project.name,
            root,
            current: project.current,
            ...rowState(!!project.running, answer, started.get(root), now, stopping.get(root)),
            ...(project.running ? { port: Number(new URL(project.running.url).port) } : {}),
            ...(tailnet[root] === undefined ? {} : { tailnetPort: tailnet[root] }),
          }
        }),
    )
    // A folder just opened or created is no project until its Ultimate registers it: it shows as starting till then.
    const fresh = [...started].flatMap(([root, at]): Row[] =>
      projects.some((project) => project.root === root) || now - at >= STARTING_MS
        ? []
        : [
            {
              name: root.split(sep).at(-1)!,
              root,
              current: false,
              ...rowState(false, undefined, at, now),
            },
          ],
    )
    return {
      at: now,
      rows: ordered([...rows, ...fresh]),
      hidden: projects
        .filter((project) => project.root && hide(project))
        .map((project) => ({ name: project.name, root: project.root! })),
    }
  },
  /** No arguments → `Folders`: the roots, and the folders in them that are not projects yet, most recent first. */
  folders: async (_args: unknown, { host }: Ctx): Promise<Folders> => {
    const projects = await host.projects()
    const known = new Set(projects.flatMap((project) => (project.root ? [project.root] : [])))
    const roots = await rootsOf(host, [...known])
    const folders = (
      await Promise.all(
        roots.map(async (root) => {
          // A root that cannot be read lists no folders; the others still do.
          const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
          return Promise.all(
            entries
              .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
              .map((entry) => join(root, entry.name))
              .filter((path) => !known.has(path))
              .map((path) => folder(root, path)),
          )
        }),
      )
    ).flat()
    return { roots, folders: folders.toSorted((a, b) => b.at - a.at) }
  },
  /**
   * `{ root }` of a running project other than this one → `{ stopping }`: SIGTERM to its supervisor, which releases its
   * core and lock (`bin/ultimate.ts` `shutdown()`); runs it interrupts resume on its next start. User-only.
   */
  stop: async (args: unknown, { host }: Ctx) => {
    const root = (args as { root?: unknown } | null)?.root
    const project = (await host.projects()).find((item) => item.root === root)
    if (!project) throw new Error('Expected { root } of a project on this machine')
    if (project.current) throw new Error('Stop this project from another project')
    if (!project.running) throw new Error(`${project.name} is not running`)
    const { pid } = project.running
    // The lock names a live pid; it must still be this project's supervisor, not a process that reused the pid.
    // Started from the tab it names its root; under `pnpm start` it runs in the root instead.
    const { stdout } = await run('ps', ['-o', 'command=', '-p', String(pid)])
    const ours =
      stdout.includes('ultimate.ts') &&
      (stdout.includes(project.root!) || (await cwdOf(pid)) === project.root)
    if (!ours) throw new Error(`pid ${pid} is not ${project.name}'s Ultimate; not stopping it`)
    process.kill(pid, 'SIGTERM')
    stopping.set(project.root!, Date.now())
    started.delete(project.root!)
    return { stopping: project.name }
  },
  /** `{ path }` of a folder under a root that is not a project yet → `{ started }`: starts Ultimate there. User-only. */
  open: async (args: unknown, { host }: Ctx) => {
    const path = (args as { path?: unknown } | null)?.path
    if (typeof path !== 'string') throw new Error('Expected { path }')
    const projects = await host.projects()
    const roots = await rootsOf(
      host,
      projects.flatMap((project) => project.root ?? []),
    )
    // Resolved first, so `..` and symlinks that lead out of every root are refused.
    const real = await realpath(path).catch(() => {
      throw new Error(`${path} does not exist`)
    })
    if (!(await stat(real)).isDirectory()) throw new Error(`${path} is not a folder`)
    if (!roots.some((root) => real.startsWith(root + sep)))
      throw new Error(`${path} is not inside a projects root`)
    const project = projects.find((item) => item.root === real)
    if (project) throw new Error(`${project.name} is already a project; Start it from its row`)
    return { started: await startRoot(host, real) }
  },
  /**
   * `{ name, root }` → `{ started, root }`: creates the folder `name` in `root` (one of the roots), runs `git init`
   * with an empty first commit there, and starts Ultimate in it. User-only.
   */
  create: async (args: unknown, { host }: Ctx) => {
    const { name, root } = (args ?? {}) as { name?: unknown; root?: unknown }
    if (typeof name !== 'string' || !validName(name))
      throw new Error('A name is letters, digits, . _ and -, starting with a letter or digit')
    const projects = await host.projects()
    const roots = await rootsOf(
      host,
      projects.flatMap((project) => project.root ?? []),
    )
    if (typeof root !== 'string' || !roots.includes(root))
      throw new Error('Expected { root } of a projects root')
    const path = join(root, name)
    // Not recursive: it fails when the folder exists, so nothing of an existing folder is touched.
    await mkdir(path).catch((error: NodeJS.ErrnoException) => {
      throw new Error(error.code === 'EEXIST' ? `${path} already exists` : error.message)
    })
    await run('git', ['init', '--quiet'], { cwd: path })
    // Without a git identity the commit fails; Ultimate's setup then offers the first commit itself.
    await run('git', ['commit', '--quiet', '--allow-empty', '--message', 'Initial commit'], {
      cwd: path,
    }).catch(() => undefined)
    return { started: await startRoot(host, path), root: path }
  },
  /** `{ root }` of a stopped project → `{}`: leaves it out of the list; its folder and conversations stay. User-only. */
  hide: async (args: unknown, { host }: Ctx) => {
    const root = (args as { root?: unknown } | null)?.root
    const project = (await host.projects()).find((item) => item.root === root)
    if (!project) throw new Error('Expected { root } of a project on this machine')
    if (project.running || project.current) throw new Error('Stop the project before hiding it')
    const hidden = await hiddenList(host)
    await saveHidden(host, [...new Set([...hidden, project.root!])])
    return {}
  },
  /** `{ root }` → `{}`: shows a hidden project again. User-only. */
  unhide: async (args: unknown, { host }: Ctx) => {
    const root = (args as { root?: unknown } | null)?.root
    await saveHidden(
      host,
      (await hiddenList(host)).filter((item) => item !== root),
    )
    return {}
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

/** A process's working directory, from `lsof`; undefined when it cannot be read. */
async function cwdOf(pid: number) {
  // No lsof or no access: the caller then refuses to signal the process.
  const { stdout } = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).catch(() => ({
    stdout: '',
  }))
  return stdout
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1)
}

/** Starts Ultimate on `root`, not a project yet, as Start does; its row shows starting once it registers. */
async function startRoot(host: Host, root: string) {
  const name = root.split(sep).at(-1)!
  const at = started.get(root)
  if (at !== undefined && Date.now() - at < STARTING_MS)
    throw new Error(`${name} is already starting`)
  started.set(root, Date.now())
  try {
    await launch(host, { name, root })
  } catch (error) {
    started.delete(root)
    throw error
  }
  return name
}

/**
 * The roots new projects come from, resolved: `projects.roots` in `~/.ultimate/settings.json` (`~/` for the home),
 * else the folders holding the projects already on this machine. Missing folders are dropped.
 */
async function rootsOf(host: Host, projectRoots: string[]) {
  // A missing or invalid settings file (reported where settings load) counts as unset here.
  const settings = (await readFile(join(host.userHome, '.ultimate/settings.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))) as { projects?: { roots?: unknown } } | null
  const configured = settings?.projects?.roots
  const roots = Array.isArray(configured)
    ? configured
        .filter((root): root is string => typeof root === 'string')
        .map((root) => (root.startsWith('~/') ? join(host.userHome, root.slice(2)) : root))
    : defaultRoots(projectRoots)
  const resolved = await Promise.all(
    // A root that does not exist (yet) offers nothing.
    roots.map((root) => realpath(root).catch(() => undefined)),
  )
  return [...new Set(resolved.filter((root): root is string => root !== undefined))]
}

/** A folder's latest activity: its git HEAD's reflog when it is a repository, else the folder's own change time. */
async function folder(root: string, path: string): Promise<Folder> {
  const name = path.split(sep).at(-1)!
  // Not a repository, or one without a reflog: the folder's own time stands in.
  const head = await stat(join(path, '.git/logs/HEAD')).catch(() => undefined)
  const git =
    head !== undefined || (await stat(join(path, '.git')).catch(() => undefined)) !== undefined
  // A folder that vanished since it was listed sorts last.
  const own = await stat(path).catch(() => undefined)
  return { name, path, root, git, at: (head ?? own)?.mtimeMs ?? 0 }
}

const hiddenPath = (host: Host) => join(host.userHome, '.ultimate/projects-hidden.json')

/** The roots of hidden projects, from `~/.ultimate/projects-hidden.json`. */
async function hiddenList(host: Host): Promise<string[]> {
  // No file yet: nothing is hidden.
  const value: unknown = await readFile(hiddenPath(host), 'utf8')
    .then(JSON.parse)
    .catch(() => [])
  return Array.isArray(value)
    ? value.filter((root): root is string => typeof root === 'string')
    : []
}

const saveHidden = (host: Host, roots: string[]) =>
  writeFile(hiddenPath(host), JSON.stringify(roots, null, 2) + '\n')

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
