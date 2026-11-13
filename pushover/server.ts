/**
 * Pushover: each project sends its own questions to the user, landings and @ultimate's reports to the user's phone
 * through Pushover, unless the user is on an Ultimate page. Reacts as Ultimate's `push` does (`extensions/push`).
 */
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
// Ultimate's own modules, from the clone (`@` is its web/src).
import { writeJson } from '@/../../lib/json-file.ts'
import { readSecret } from '@/../../lib/secrets.ts'
import type { ExtensionHost } from '@/../../server/extensions.ts'
import { Messages, MessageSent } from '@/../../extensions/messages/api.ts'
import type { Message } from '@/../../extensions/messages/api.ts'
import { Standing } from '@/../../extensions/subagents/api.ts'
import { TailscaleApi } from '@/../../extensions/tailscale/api.ts'
import { SubmissionLanded } from '@/../../extensions/workspaces/api.ts'
import { asker, batched, gather, landingNote, present, questionNote, reportNote } from './rules.ts'
import type { Note } from './rules.ts'

const API = 'https://api.pushover.net/1/messages.json'
const MISSING = 'Pushover: add PUSHOVER_TOKEN and PUSHOVER_USER in Secrets to get notifications'

/** Shared by every project on this machine: any Ultimate page in use keeps them all quiet. */
const presenceFile = (host: ExtensionHost) =>
  join(host.userHome, '.ultimate/pushover-presence.json')

async function presentAt(host: ExtensionHost) {
  // No file yet, or one cut short mid-write: nobody reported in, so the user counts as away.
  const value = await readFile(presenceFile(host), 'utf8')
    .then((text) => (JSON.parse(text) as { at?: unknown }).at)
    .catch(() => undefined)
  return typeof value === 'number' ? value : undefined
}

/** This server's tailnet HTTPS address, or its loopback one without Tailscale. */
const origin = (host: ExtensionHost) =>
  host.want(TailscaleApi)?.status().url ?? host.system().process.url

const project = (host: ExtensionHost) => basename(host.projectRoot)

async function keys(host: ExtensionHost) {
  const [token, user] = await Promise.all([
    readSecret(host.userHome, 'PUSHOVER_TOKEN'),
    readSecret(host.userHome, 'PUSHOVER_USER'),
  ])
  return token && user ? { token, user } : undefined
}

type Outcome = { skipped: 'present' | 'no keys' } | { status: number; errors?: string[] }

/**
 * Sends `note` unless the user is present (or `force`) or the keys are missing. A refusal becomes a notice; a network
 * failure rejects, for the caller's `track` to report.
 */
async function deliver(host: ExtensionHost, note: Note, force = false): Promise<Outcome> {
  if (!force && present(await presentAt(host), Date.now())) return { skipped: 'present' }
  const auth = await keys(host)
  // Without the keys it stays quiet: opening said so once.
  if (!auth) return { skipped: 'no keys' }
  const body = new URLSearchParams({
    ...auth,
    title: note.title,
    message: note.message,
    url: note.url,
    url_title: note.url_title,
    ...(note.ttl ? { ttl: String(note.ttl) } : {}),
  })
  const response = await fetch(API, { method: 'POST', body, signal: AbortSignal.timeout(15_000) })
  const result = (await response.json().catch(() => ({}))) as { status?: number; errors?: string[] }
  if (result.status !== 1)
    host.notice(`Pushover: ${result.errors?.join('; ') || `HTTP ${response.status}`}`)
  return { status: result.status ?? 0, ...(result.errors ? { errors: result.errors } : {}) }
}

/** The notification a message to the user makes: a question, @ultimate's report, or none. */
function noteOf(
  host: ExtensionHost,
  message: Message,
  standing: Record<string, number>,
): { question: boolean; note: Note } | undefined {
  if (message.to !== 'user' || typeof message.from !== 'number') return undefined
  const title = host.conversations().find((each) => each.id === message.from)?.title
  const question = questionNote(
    project(host),
    message,
    asker(message.from, standing, title),
    origin(host),
  )
  if (question) return { question: true, note: question }
  const report = reportNote(project(host), message, standing.ultimate, origin(host))
  return report && { question: false, note: report }
}

export default function pushover(host: ExtensionHost) {
  const sending = new Set<Promise<unknown>>()
  const track = (work: Promise<unknown>) => {
    const tracked = work
      .catch((error: unknown) => host.notice(`Pushover: ${String(error)}`))
      .finally(() => sending.delete(tracked))
    sending.add(tracked)
  }

  // The window outlives a reload, so a question before and one after it still go out together; whichever facet is
  // loaded when it ends sends them. One the process exits with is skipped, as the design allows.
  const questions = host.resource('pushover.questions', () => {
    const shared = {
      send: undefined as ((gathered: (Note & { id: number })[]) => void) | undefined,
      window: gather<Note & { id: number }>((gathered) => shared.send?.(gathered)),
    }
    return shared
  })
  /** The window's questions still waiting on the user, as one notification. */
  const send = (gathered: (Note & { id: number })[]) =>
    track(
      (async () => {
        const board = await host.harness().snapshot(Messages, ROOT_CONVERSATION_ID, context)
        const open = gathered.filter(({ id }) =>
          board?.messages.some(
            (each) => each.id === id && (each.state === 'sent' || each.state === 'delivered'),
          ),
        )
        const note = batched(project(host), open, origin(host))
        if (note) await deliver(host, note)
      })(),
    )
  questions.send = send

  host.react(
    'messages',
    [MessageSent],
    async (tx, { data }) => {
      if (data.to !== 'user') return
      const message = (await tx.doc(Messages, ROOT_CONVERSATION_ID)).messages.find(
        (each) => each.id === data.message,
      )
      if (!message) return
      const made = noteOf(host, message, await tx.doc(Standing, ROOT_CONVERSATION_ID))
      if (made?.question) questions.window.add(message.id, { ...made.note, id: message.id })
      else if (made) track(deliver(host, made.note))
    },
    { from: 'now' },
  )
  host.react(
    'landings',
    [SubmissionLanded],
    (_tx, { data }) => track(deliver(host, landingNote(project(host), data, origin(host)))),
    { from: 'now' },
  )

  host.onOpen(async () => {
    // Once per process, not on each reload of the facet.
    const told = host.resource('pushover.told', () => ({ missing: false }))
    if (told.missing || (await keys(host))) return
    told.missing = true
    host.notice(MISSING)
  })
  const close = async () => {
    // A replacement facet may have taken over already.
    if (questions.send === send) questions.send = undefined
    while (sending.size) await Promise.all(sending)
  }
  host.onRelease(close)
  host.onClose(close)
  return defineExtension({ name: 'pushover' })
}

export const userActions = ['present']
export const actions = {
  /** No arguments: a page in use says the user is here, for every project on this machine. */
  present: async (_args: unknown, { host }: { host: ExtensionHost }) => {
    // Atomically: a half-written file would read as the user being away.
    await writeJson(presenceFile(host), { at: Date.now() })
    return null
  },
  /**
   * `{ message?, landing?, force? }` → the Pushover outcome and what was sent: the notification message `message` (a
   * question or @ultimate's report to the user) or the newest landing (`landing: true`) makes, else a test line.
   * Skipped while the user is present, unless `force`.
   */
  test: async (args: unknown, { host }: { host: ExtensionHost }) => {
    const { message, landing, force } = (args ?? {}) as {
      message?: number
      landing?: boolean
      force?: boolean
    }
    let note: Note | undefined
    if (message !== undefined) {
      const [board, standing] = await Promise.all([
        host.harness().snapshot(Messages, ROOT_CONVERSATION_ID, context),
        host.harness().snapshot(Standing, ROOT_CONVERSATION_ID, context),
      ])
      const found = board?.messages.find((each) => each.id === message)
      if (!found) throw new Error(`No message ${message}`)
      note = noteOf(host, found, standing ?? {})?.note
      if (!note) throw new Error(`Message ${message} is no question or report to the user`)
    } else if (landing) {
      const [newest] = await host.eventLog.recent({ events: [SubmissionLanded], limit: 1 })
      if (!newest) throw new Error('No landing yet')
      note = landingNote(project(host), newest.data, origin(host))
    } else
      note = {
        title: `${project(host)} · test`,
        message: 'Pushover notifications are on for this project.',
        url: origin(host),
        url_title: 'Open Ultimate',
      }
    return { ...(await deliver(host, note, force === true)), note }
  },
}
