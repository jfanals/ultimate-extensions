import { BellIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  defineWebExtension,
  docRef,
  useConversation,
  useConversations,
  useDocOf,
  useUiState,
} from '@/sdk'
import { favicon, looks, offerBadge, prefixed, tabStatus } from './status.ts'
import type { TabStatus } from './status.ts'

/** The messages extension's `board` document: only the fields that tell an open question for the user. */
const MessagesDoc = docRef<{
  messages: { to: number | 'user' | 'remote'; reply: boolean; state: string }[]
}>('board')
/** The conversations extension's overview: each conversation's run state. */
const OverviewDoc = docRef<{ conversations: Record<string, { runState?: string }> }>(
  'ultimate.conversation-overview',
)

const PLAIN = '/favicon.svg'

/** Keeps the tab's favicon, title prefix and app badge on the project's status. Renders nothing. */
function TabStatusSignals() {
  const messages = useDocOf(1, MessagesDoc)?.messages ?? []
  const overview = useDocOf(1, OverviewDoc)?.conversations ?? {}
  const conversations = useConversations()
  const shown = useConversation().id
  const [seen] = useUiState<Record<string, number>>('ext.conversations.seen', {})
  const [concluded] = useUiState<number[]>('ext.conversations.concluded', [])
  const waiting = messages.filter(
    (message) => message.to === 'user' && message.reply && message.state === 'delivered',
  ).length
  const status = tabStatus({
    conversations,
    runStates: Object.fromEntries(Object.entries(overview).map(([id, row]) => [id, row.runState])),
    waiting,
    seen,
    concluded,
    shown,
  })
  useFavicon(status)
  useTitle(status)
  useBadge(waiting, useNotificationPermission())
  return null
}

/** `Notification.permission`, kept current when the user allows it here or changes it in the site settings. */
function useNotificationPermission() {
  const [permission, setPermission] = useState(() =>
    'Notification' in window ? Notification.permission : undefined,
  )
  useEffect(() => {
    let status: PermissionStatus | undefined
    const update = () => setPermission(Notification.permission)
    void navigator.permissions
      ?.query({ name: 'notifications' })
      .then((result) => {
        status = result
        status.addEventListener('change', update)
      })
      // Without the Permissions API the click handler's own update still applies.
      .catch(() => {})
    window.addEventListener(PERMISSION_EVENT, update)
    return () => {
      status?.removeEventListener('change', update)
      window.removeEventListener(PERMISSION_EVENT, update)
    }
  }, [])
  return permission
}

const PERMISSION_EVENT = 'tab-status:permission'

/**
 * "Allow Dock badge" in the status line while notification permission is undecided: macOS badges an app window's Dock
 * icon only once it may notify, and the browser asks only on a click. Gone for good once allowed or blocked.
 */
function AllowBadge() {
  const permission = useNotificationPermission()
  if (!offerBadge(permission, 'setAppBadge' in navigator)) return null
  return (
    <button
      className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-sm px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      data-allow-badge
      onClick={() =>
        void Notification.requestPermission().then(() =>
          window.dispatchEvent(new Event(PERMISSION_EVENT)),
        )
      }
      title="Let this app window show the count of questions waiting on you in the Dock. No notifications are sent."
      type="button"
    >
      <BellIcon className="size-3" />
      <span className="max-md:hidden">Allow Dock badge</span>
    </button>
  )
}

function useFavicon(status: TabStatus) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    const dot = looks[status].dot
    link.href = dot ? favicon(dot) : PLAIN
  }, [status])
  useEffect(
    () => () => {
      document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', PLAIN)
    },
    [],
  )
}

/** The core sets the title with its own busy dot whenever the shown conversation changes; this puts our prefix back. */
function useTitle(status: TabStatus) {
  useEffect(() => {
    const apply = () => {
      const next = prefixed(document.title, status)
      if (next !== document.title) document.title = next
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  }, [status])
}

/** The Dock badge of an installed app window counts the questions waiting on the user. */
function useBadge(count: number, permission: string | undefined) {
  // Re-applied when permission changes: macOS shows the badge only after it is granted.
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    const done = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()
    // A browser tab (not an installed app) may refuse the badge; nothing else depends on it.
    done.catch(() => {})
  }, [count, permission])
}

export default defineWebExtension({
  slots: {
    overlay: [TabStatusSignals],
    'statusline.right': [{ component: AllowBadge, order: -3 }],
  },
})
