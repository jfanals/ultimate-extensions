/** The project's status for the browser tab, from the same data the sidebar and the To-dos panel read. */

export type TabStatus = 'needs-you' | 'failed' | 'working' | 'answer' | 'idle'

export type StatusInput = {
  conversations: readonly {
    id: number
    ownerTaskId?: number
    busy: boolean
    answerAt?: number
  }[]
  /** The root's overview rows by conversation id (`ultimate.conversation-overview`). */
  runStates: Record<string, string | undefined>
  /** Messages to the user that still wait on their answer. */
  waiting: number
  /** The sidebar's `ext.conversations.seen`: the latest answer the user saw, by conversation. */
  seen: Record<string, number>
  /** The sidebar's `ext.conversations.concluded`. */
  concluded: readonly number[]
  /** The conversation on screen, whose answer counts as seen. */
  shown?: number
}

/** Needs you, then failed, then working, then a new answer; idle when none applies. */
export function tabStatus(input: StatusInput): TabStatus {
  if (input.waiting > 0) return 'needs-you'
  const concluded = new Set(input.concluded)
  // Subagents report to their parent, so only top-level conversations (branches, standing agents) count as failed or answered.
  const top = input.conversations.filter(
    (conversation) => conversation.ownerTaskId === undefined && !concluded.has(conversation.id),
  )
  const working = (conversation: StatusInput['conversations'][number]) =>
    conversation.busy || ['working', 'queued'].includes(input.runStates[conversation.id] ?? '')
  if (
    top.some(
      (conversation) => !working(conversation) && input.runStates[conversation.id] === 'error',
    )
  )
    return 'failed'
  if (input.conversations.some(working)) return 'working'
  const unseen = top.some((conversation) => {
    const recorded = input.seen[conversation.id]
    return (
      recorded !== undefined &&
      (conversation.answerAt ?? 0) > recorded &&
      conversation.id !== input.shown
    )
  })
  return unseen ? 'answer' : 'idle'
}

/** The title prefix and the favicon dot of each status: the sidebar's tones, in their dark-theme shades. */
export const looks: Record<TabStatus, { emoji?: string; dot?: string }> = {
  'needs-you': { emoji: '🟡', dot: '#fbbf24' },
  failed: { emoji: '🔴', dot: '#f87171' },
  working: { emoji: '🟣', dot: '#a855f7' },
  answer: { emoji: '🟢', dot: '#4ade80' },
  idle: {},
}

/** Every prefix a title can carry: the core's busy dot and ours. */
const PREFIX = /^(?:● |🟡 |🔴 |🟣 |🟢 )+/u

/** The title with the status's prefix in place of the core's or an earlier one. */
export function prefixed(title: string, status: TabStatus) {
  const emoji = looks[status].emoji
  const bare = title.replace(PREFIX, '')
  return emoji ? `${emoji} ${bare}` : bare
}

/**
 * Whether to offer "Allow Dock badge": macOS shows an app window's badge only once the app may notify, and the browser
 * asks only on a click. Never again once granted or denied.
 */
export function offerBadge(permission: string | undefined, badging: boolean) {
  return badging && permission === 'default'
}
