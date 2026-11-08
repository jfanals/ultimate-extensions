/** The Projects overview's shapes and the pure rules behind it: row state, totals, links. Browser-safe. */
import type { TabStatus } from '../tab-status/status.ts'

/** A message waiting on the user's answer, as `messages`' `openQuestions()` lists it. */
export type Waiting = {
  message: number
  conversation: number
  at: number
  text: string
}

/** What one instance says about itself (`projects/here`). */
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

/** Waiting messages across projects and how many projects they are in, how many projects work, and every question oldest first. */
export function totals(rows: readonly Row[]) {
  const waitingRows = rows.filter((row) => row.waiting.length > 0)
  return {
    waiting: waitingRows.reduce((sum, row) => sum + row.waiting.length, 0),
    projects: waitingRows.length,
    working: rows.filter((row) => row.busy > 0).length,
    questions: rows
      .flatMap((row) => row.waiting.map((question) => ({ ...question, project: row })))
      .toSorted((a, b) => a.at - b.at),
  }
}

/** A question's one line without the `questions ` its card header starts with. */
export const questionLine = (text: string) => text.replace(/^questions /, '')

/** Rows in a steady order: the current project first, then by name. */
export const ordered = (rows: readonly Row[]) =>
  rows.toSorted((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name))

/**
 * Where a project opens from this page: same protocol and host, the project's port. Over the tailnet (HTTPS) that is its
 * tailnet port; on loopback or `ultimate.localhost` its local one. With `question`, opened at that message's
 * conversation. `#projects-open` tells the target to show its conversation even when it was last left on Projects, and
 * `#projects-open:<message>` to scroll to that question.
 */
export function projectUrl(
  page: { protocol: string; hostname: string },
  row: Pick<Row, 'port' | 'tailnetPort'>,
  question?: Pick<Waiting, 'conversation' | 'message'>,
) {
  const port = page.protocol === 'https:' ? row.tailnetPort : row.port
  if (port === undefined) return undefined
  const at = question ? `?conversation=${question.conversation}` : ''
  return `${page.protocol}//${page.hostname}:${port}/${at}${ARRIVAL}${question ? `:${question.message}` : ''}`
}

const ARRIVAL = '#projects-open'

/** What a page's hash asks on arrival from another project: nothing, the conversation, or one question in it. */
export function arrival(hash: string): { message?: number } | undefined {
  if (hash === ARRIVAL) return {}
  const match = new RegExp(`^${ARRIVAL}:(\\d+)$`).exec(hash)
  return match ? { message: Number(match[1]) } : undefined
}

/**
 * Whether `name` may be a new project's folder: one plain path segment of letters, digits, `.`, `_` and `-`, not
 * starting with a dot or dash, so it can never name a parent, a hidden folder or an option.
 */
export const validName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)

/** Without the `projects.roots` setting: the folders that hold the projects already on this machine. */
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
