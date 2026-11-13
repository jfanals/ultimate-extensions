/** The Fleet overview's shapes and the pure rules behind it: row state, totals, links. Browser-safe. */
import type { TabStatus } from '../tab-status/status.ts'

/** One question a message asks, as messages stores it (`extensions/messages/refs.ts` `Question`). */
export type Question = {
  text: string
  kind: 'choice' | 'multi' | 'confirm' | 'text' | 'scale'
  ref?: string
  options?: { label: string; key?: string; detail?: string; recommended?: boolean }[]
  scale?: { min: number; max: number; low?: string; high?: string }
}

/**
 * A message waiting on the user's answer, as `messages`' `openQuestions()` lists it, with its whole `text`, its
 * `questions` and how many images it forwards, read from that project's Messages log.
 */
export type Waiting = {
  message: number
  conversation: number
  at: number
  text: string
  questions?: Question[]
  images?: number
}

/** What one instance says about itself (`fleet/here`). */
export type Here = { status: TabStatus; busy: number; waiting: Waiting[] }

/** A row's state: an instance's own status, or why there is none. */
export type RowState = TabStatus | 'stopped' | 'starting' | 'stopping' | 'unreachable'

export type Row = {
  name: string
  root: string
  current: boolean
  state: RowState
  busy: number
  waiting: Waiting[]
  /** Loopback port of a running instance; the page swaps it into its own origin. */
  port?: number
  /** Its HTTPS port on the tailnet (`~/.ultimate/tailscale.json`), for a page loaded from the tailnet. */
  tailnetPort?: number
  error?: string
}

/** `hidden`: stopped projects the user hid from the list, by name and root. */
export type Overview = {
  at: number
  rows: Row[]
  hidden: { name: string; root: string }[]
}

/** A folder under a root that is not a project yet; `at` is its latest activity (git, else the folder's own). */
export type Folder = {
  name: string
  path: string
  root: string
  at: number
  git: boolean
}

/** The roots new projects come from, and the folders in them that are not projects yet, most recent first. */
export type Folders = { roots: string[]; folders: Folder[] }

/** How long a started project shows as starting before it counts as stopped again; a stopped one as stopping. */
export const STARTING_MS = 2 * 60_000
export const STOPPING_MS = 30_000

/**
 * A project's row from the registry entry and its instance's answer (or failure); `startedAt` when Start ran,
 * `stoppingAt` when Stop ran.
 */
export function rowState(
  running: boolean,
  answer: { here: Here } | { error: string } | undefined,
  startedAt: number | undefined,
  now: number,
  stoppingAt?: number,
): Pick<Row, 'state' | 'busy' | 'waiting' | 'error'> {
  if (running && stoppingAt !== undefined && now - stoppingAt < STOPPING_MS)
    return { state: 'stopping', busy: 0, waiting: [] }
  if (!running)
    return {
      state: startedAt !== undefined && now - startedAt < STARTING_MS ? 'starting' : 'stopped',
      busy: 0,
      waiting: [],
    }
  if (!answer || 'error' in answer)
    return {
      state: 'unreachable',
      busy: 0,
      waiting: [],
      ...(answer ? { error: answer.error } : {}),
    }
  return {
    state: answer.here.status,
    busy: answer.here.busy,
    waiting: answer.here.waiting,
  }
}

/** Waiting messages across projects and how many projects they are in, and how many projects work. */
export function totals(rows: readonly Row[]) {
  const waitingRows = rows.filter((row) => row.waiting.length > 0)
  return {
    waiting: waitingRows.reduce((sum, row) => sum + row.waiting.length, 0),
    projects: waitingRows.length,
    working: rows.filter((row) => row.busy > 0).length,
  }
}

/** The projects with questions waiting, each with its questions oldest first; the project waiting longest first. */
export const groups = (rows: readonly Row[]) =>
  rows
    .filter((row) => row.waiting.length > 0)
    .map((row) => ({ row, questions: row.waiting.toSorted((a, b) => a.at - b.at) }))
    .toSorted((a, b) => a.questions[0].at - b.questions[0].at)

/** The Inbox key of question `message` waiting in project `name`. */
export const itemKey = (name: string, message: number) => `fleet:${name}:${message}`

/**
 * The questions waiting in the other projects, for this project's Inbox: each with its key, its project's row and the
 * question. This project's own are the Inbox's already.
 */
export const elsewhereItems = (rows: readonly Row[]) =>
  rows
    .filter((row) => !row.current)
    .flatMap((row) =>
      row.waiting.map((question) => ({ key: itemKey(row.name, question.message), row, question })),
    )

/** Rows in a steady order: the current project first, then by name. */
export const ordered = (rows: readonly Row[]) =>
  rows.toSorted((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name))

/**
 * Where a project opens from this page: same protocol and host, the project's port. Over the tailnet (HTTPS) that is its
 * tailnet port; on loopback or `ultimate.localhost` its local one. With `message`, at that item in its Inbox
 * (`?inbox=<message>`, the inbox extension's link). Without, `#fleet-open` tells the target to show its conversation
 * even when it was last left on Fleet.
 */
export function projectUrl(
  page: { protocol: string; hostname: string },
  row: Pick<Row, 'port' | 'tailnetPort'>,
  message?: number,
) {
  const port = page.protocol === 'https:' ? row.tailnetPort : row.port
  if (port === undefined) return undefined
  return `${page.protocol}//${page.hostname}:${port}/${message === undefined ? ARRIVAL : `?inbox=${message}`}`
}

/** The hash a project opened from another project's Fleet arrives with: show the conversation, not Fleet. */
export const ARRIVAL = '#fleet-open'

/**
 * Whether `name` may be a new project's folder: one plain path segment of letters, digits, `.`, `_` and `-`, not
 * starting with a dot or dash, so it can never name a parent, a hidden folder or an option.
 */
export const validName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)

/** Without the `fleet.roots` setting: the folders that hold the projects already on this machine. */
export const defaultRoots = (projectRoots: readonly string[]) => [
  ...new Set(
    projectRoots
      .map((root) => root.replace(/\/+$/, '').replace(/\/[^/]+$/, ''))
      .filter((parent) => parent !== ''),
  ),
]

/** The environment a started project gets: this instance's ULTIMATE_* variables would make it share this home or port. */
export const startEnv = (env: Readonly<Record<string, string | undefined>>) =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('ULTIMATE_')))
