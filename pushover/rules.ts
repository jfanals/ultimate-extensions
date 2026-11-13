/** What a Pushover notification says, when questions fold into one, and when the user counts as present. Pure. */

/** The fields of a message (`extensions/messages/refs.ts` `Message`) a notification reads. */
export type Message = {
  id: number
  from: number | 'user' | 'remote'
  to: number | 'user' | 'remote'
  reply: boolean
  text: string
  questions?: {
    text: string
    ref?: string
    options?: { label: string; key?: string; recommended?: boolean }[]
  }[]
}

/** A Pushover message's fields (https://pushover.net/api); `ttl` in seconds. */
export type Note = {
  title: string
  message: string
  url: string
  url_title: string
  ttl?: number
}

/** How long questions gather into one notification, and how long a heartbeat counts as the user being there. */
export const WINDOW_MS = 60_000
/** A notification that expires after a day: a report or landing is old news by then. */
const DAY = 86_400

/** Pushover's limits: 250 characters of title, 1024 of message. */
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The first non-empty line, without Markdown emphasis. */
const firstLine = (text: string) =>
  (
    text
      .replaceAll('**', '')
      .split('\n')
      .find((line) => line.trim()) ?? ''
  ).trim()

/** A report's bold lead (`**Done:** …` → `Done:`), or else its first line. */
export function lead(text: string) {
  const bold = /^\s*\*\*(.+?)\*\*/.exec(text)?.[1]?.trim()
  return cut(bold || firstLine(text), 1024)
}

/** The first question, and its recommended pick named as the card does (`1a Italian`). */
export function questionText(message: Pick<Message, 'text' | 'questions'>) {
  const [first, ...rest] = message.questions ?? []
  if (!first) return cut(firstLine(message.text), 1024)
  const picks = (first.options ?? [])
    .filter((option) => option.recommended)
    .map((option) =>
      [`${first.ref ?? ''}${option.key ?? ''}`, option.label].filter(Boolean).join(' '),
    )
  const more = rest.length ? ` (+${rest.length} more)` : ''
  return cut(
    `${first.text}${picks.length ? ` → recommended: ${picks.join(', ')}` : ''}${more}`,
    1024,
  )
}

/** Who asks: a standing agent by `@name`, a branch by its title, else `#id`. */
export function asker(from: number, standing: Record<string, number>, title: string | undefined) {
  const name = Object.entries(standing).find(([, id]) => id === from)?.[0]
  return name ? `@${name}` : title || `#${from}`
}

/** A question waiting on the user, linking to it in the Inbox; none for any other message. */
export function questionNote(
  project: string,
  message: Message,
  who: string,
  origin: string,
): Note | undefined {
  if (message.to !== 'user' || !message.reply || typeof message.from !== 'number') return undefined
  return {
    title: cut(`${project} · ${who} asks`, 250),
    message: questionText(message),
    url: `${origin}/?inbox=${message.id}`,
    url_title: 'Open in Inbox',
  }
}

/** @ultimate's report to the user, a message that waits for no reply; none for any other message. */
export function reportNote(
  project: string,
  message: Message,
  ultimate: number | undefined,
  origin: string,
): Note | undefined {
  if (message.to !== 'user' || message.reply || message.from !== ultimate) return undefined
  return {
    title: cut(`${project} · done`, 250),
    message: lead(message.text) || 'Finished.',
    url: `${origin}/?conversation=${ultimate}`,
    url_title: 'Open conversation',
    ttl: DAY,
  }
}

export const landingNote = (
  project: string,
  landing: { title: string; conversationId: number },
  origin: string,
): Note => ({
  title: cut(`${project} · landed`, 250),
  message: cut(firstLine(landing.title), 1024) || 'Landed.',
  url: `${origin}/?conversation=${landing.conversationId}`,
  url_title: 'Open conversation',
  ttl: DAY,
})

/** The questions gathered in one window as one notification: the question itself, or how many wait. */
export function batched(project: string, notes: Note[], origin: string): Note | undefined {
  if (notes.length <= 1) return notes[0]
  return {
    title: cut(`${notes.length} questions waiting in ${project}`, 250),
    message: notes
      .map((note) => note.message.split('\n')[0])
      .join('\n')
      .slice(0, 1024),
    url: `${origin}/?inbox=`,
    url_title: 'Open in Inbox',
  }
}

/**
 * Gathers items for `ms` from the first one, then hands them to `send` together; an item added again under the same
 * key (a retried reactor transaction) counts once. A window still open when the process exits is dropped.
 */
export function gather<T>(send: (items: T[]) => void, ms = WINDOW_MS) {
  let items = new Map<number, T>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    timer = undefined
    const due = [...items.values()]
    items = new Map()
    send(due)
  }
  return {
    add(key: number, item: T) {
      items.set(key, item)
      // A window never keeps the process alive.
      timer ??= setTimeout(flush, ms)
      timer.unref?.()
    },
  }
}

/** Whether a page reported the user there (`~/.ultimate/pushover-presence.json`'s `at`) within the window. */
export const present = (at: number | undefined, now: number) =>
  at !== undefined && now - at < WINDOW_MS
