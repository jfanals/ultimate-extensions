/** @jsxImportSource @solidjs/web */
import { Bell } from '@lucide/solid'
import { createEffect, createMemo, onSettled, Show } from 'solid-js'
import type { Accessor } from 'solid-js'
import { StatusButton } from '@/components/ui/status-trigger.solid.tsx'
import {
  ROOT,
  defineWebExtension,
  docRef,
  keepLast,
  useConversationId,
  useConversations,
  useDocOf,
  useExternal,
  useSystem,
  useUiState,
} from '@/sdk/solid'
import { projectName, tile, useOverrides } from '../project-icon/ui.solid.tsx'
import { looks, offerBadge, prefixed, tabStatus } from './status.ts'
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
  const board = useDocOf(() => ROOT, MessagesDoc)
  const overview = useDocOf(() => ROOT, OverviewDoc)
  const conversations = useConversations()
  const shown = useConversationId()
  const [seen] = useUiState<Record<string, number>>('ext.conversations.seen', {})
  const [concluded] = useUiState<number[]>('ext.conversations.concluded', [])
  const waiting = createMemo(
    () =>
      (board()?.messages ?? []).filter(
        (message) => message.to === 'user' && message.reply && message.state === 'delivered',
      ).length,
  )
  const status = createMemo(() =>
    tabStatus({
      conversations: conversations(),
      runStates: Object.fromEntries(
        Object.entries(overview()?.conversations ?? {}).map(([id, row]) => [id, row.runState]),
      ),
      waiting: waiting(),
      seen: seen(),
      concluded: concluded(),
      shown: shown(),
    }),
  )
  useFavicon(status)
  useTitle(status)
  useBadge(waiting, useNotificationPermission())
  return null
}

const PERMISSION_EVENT = 'tab-status:permission'

/** `Notification.permission`, kept current when the user allows it here or changes it in the site settings. */
function useNotificationPermission() {
  return useExternal(
    () => ('Notification' in window ? Notification.permission : undefined),
    (update) => {
      let status: PermissionStatus | undefined
      void navigator.permissions
        ?.query({ name: 'notifications' })
        .then((result) => {
          status = result
          status.addEventListener('change', update)
        })
        // Without the Permissions API the click handler's own update still applies.
        .catch(keepLast)
      window.addEventListener(PERMISSION_EVENT, update)
      return () => {
        status?.removeEventListener('change', update)
        window.removeEventListener(PERMISSION_EVENT, update)
      }
    },
  )
}

/**
 * "Allow Dock badge" in the status line while notification permission is undecided: macOS badges an app window's Dock
 * icon only once it may notify, and the browser asks only on a click. Gone for good once allowed or blocked.
 */
function AllowBadge() {
  const permission = useNotificationPermission()
  return (
    <Show when={offerBadge(permission(), 'setAppBadge' in navigator)}>
      <StatusButton
        aria-label="Allow Dock badge"
        class="text-muted-foreground"
        data-allow-badge
        onClick={() =>
          void Notification.requestPermission().then(() =>
            window.dispatchEvent(new Event(PERMISSION_EVENT)),
          )
        }
        title="Let this app window show the count of questions waiting on you in the Dock. No notifications are sent."
      >
        <Bell class="size-3" />
        <span class="max-md:hidden">Allow Dock badge</span>
      </StatusButton>
    </Show>
  )
}

/** The project's tile (project-icon), with the status's dot in its corner. */
function useFavicon(status: Accessor<TabStatus>) {
  const system = useSystem()
  const overrides = useOverrides()
  createEffect(
    () => ({ root: system()?.project.root, status: status(), overrides: overrides() }),
    (current) => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (!link || !current.root) return
      const name = projectName(current.root)
      const dot = looks[current.status].dot
      link.href = tile(name, { override: current.overrides[name], ...(dot ? { dot } : {}) })
    },
  )
  onSettled(
    () => () =>
      document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', PLAIN),
  )
}

/** The core sets the title with its own busy dot whenever the shown conversation changes; this puts our prefix back. */
function useTitle(status: Accessor<TabStatus>) {
  createEffect(status, (current) => {
    const apply = () => {
      const next = prefixed(document.title, current)
      if (next !== document.title) document.title = next
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  })
}

/** The Dock badge of an installed app window counts the questions waiting on the user. */
function useBadge(count: Accessor<number>, permission: Accessor<string | undefined>) {
  // Re-applied when permission changes: macOS shows the badge only after it is granted.
  createEffect(
    () => ({ count: count(), permission: permission() }),
    (current) => {
      if (!('setAppBadge' in navigator)) return
      const done =
        current.count > 0 ? navigator.setAppBadge(current.count) : navigator.clearAppBadge()
      // A browser tab (not an installed app) may refuse the badge; nothing else depends on it.
      done.catch((error: unknown) => console.debug('tab-status: no app badge', error))
    },
  )
}

export default defineWebExtension({
  slots: {
    overlay: [TabStatusSignals],
    'statusline.right': [{ component: AllowBadge, order: -3 }],
  },
})
