import type { EntryRecord } from '@earendil-works/pi-durable'
import { FlameIcon, RefreshCwIcon } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  actionRef,
  api,
  cn,
  defineWebExtension,
  docRef,
  formatAgo,
  useAction,
  useDocOf,
  useNow,
  useTranscript,
} from '@/sdk'
import { dollars, failText, warmAnchor, warmText } from './notice.ts'
import type { Miss, Warm } from './notice.ts'

type Summary = {
  last?: Miss & { conversation: number }
  week: { count: number; cost: number }
  warmed: { count: number; cost: number }
  failed?: Warm
}

const WarmsAction = actionRef<{ conversation: number }, Warm[]>('prompt-cache', 'warms')
const SummaryAction = actionRef<null, Summary>('prompt-cache', 'summary')
const WarmsDoc = docRef<{ warms: Warm[] }>('cache.warms')

/**
 * Each conversation's pings, fetched once: every row of a transcript reads the same answer, and a new ping or a
 * five-minute tick (a settings change) asks again.
 */
const notes = new Map<number, { key: string; value?: Warm[] }>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Pings of the entry's conversation. */
function useWarms(entry: EntryRecord) {
  const conversation = entry.conversationId
  const warmed = useDocOf(1, WarmsDoc)?.warms.at(-1)?.at ?? 0
  const tick = Math.floor(useNow(60_000) / 300_000)
  const key = `${warmed}:${tick}`
  useEffect(() => {
    if (notes.get(conversation)?.key === key) return
    const value = notes.get(conversation)?.value
    notes.set(conversation, { key, ...(value ? { value } : {}) })
    api
      .action(WarmsAction, { conversation })
      .then((fresh) => {
        if (notes.get(conversation)?.key !== key) return
        notes.set(conversation, { key, value: fresh })
        for (const listener of listeners) listener()
      })
      // The pings stay as they were; the next ping or tick asks again.
      .catch((error: unknown) => console.warn('Cache warms', error))
  }, [conversation, key])
  return useSyncExternalStore(subscribe, () => notes.get(conversation)?.value)
}

/** A quiet divider across the transcript, as `models` marks a switch: rules either side of a short line. */
function Divider({
  tone,
  icon,
  children,
  title,
}: {
  tone: string
  icon?: ReactNode
  children: ReactNode
  title: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 font-mono text-[11px] before:h-px before:flex-1 before:bg-border/70 after:h-px after:flex-1 after:bg-border/70',
        tone,
      )}
      data-cache-note
      title={title}
    >
      <span className="flex max-w-[80%] min-w-0 items-center gap-1.5">
        {icon}
        <span className="truncate">{children}</span>
      </span>
    </div>
  )
}

/** Pings between this reply and the next, grey; a failed one red. */
function WarmLines({ warms }: { warms: Warm[] }) {
  const ok = warmText(warms)
  const failed = warms.filter((warm) => warm.error !== undefined)
  return (
    <>
      {ok && (
        <Divider
          icon={<FlameIcon className="size-3 shrink-0" />}
          title={`keep-warm renewed @ultimate's prompt cache while it was idle (cost of its cache read and write): ${warms
            .filter((warm) => warm.error === undefined)
            .map((warm) =>
              new Date(warm.at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
            )
            .join(', ')}`}
          tone="text-muted-foreground/60"
        >
          {ok}
        </Divider>
      )}
      {failed.map((warm) => (
        <Divider
          icon={<FlameIcon className="size-3 shrink-0" />}
          key={warm.at}
          title="keep-warm's ping failed; no more pings until @ultimate's next answer"
          tone="text-error"
        >
          {failText(warm)}
        </Divider>
      ))}
    </>
  )
}

/** A reply: the keep-warm pings after it below. Compact mode can split a reply into rows of its blocks: the last. */
function Reply({
  entry,
  core,
  blocks,
}: {
  entry: EntryRecord
  core: ReactNode
  blocks?: readonly number[]
}) {
  const found = useWarms(entry)
  const entries = useTranscript()
  if (!found?.length) return core
  const blockCount = (entry.model?.[0] as { content?: unknown[] } | undefined)?.content?.length ?? 0
  const last = !blocks || blocks.includes(blockCount - 1)
  let warms: Warm[] = []
  if (last) {
    const replies = entries.flatMap((item) => {
      const message = item.model?.[0]
      return item.conversationId === entry.conversationId && item.kind === 'pi.assistant' && message
        ? [{ id: item.id, at: message.timestamp }]
        : []
    })
    warms = found.filter((warm) => warmAnchor(replies, warm) === entry.id)
  }
  if (warms.length === 0) return core
  return (
    <div className="flex flex-col gap-3">
      {core}
      <WarmLines warms={warms} />
    </div>
  )
}

/** The status-line chip: the last rebuild and this week's, amber after a miss, red after a failed ping. */
function Chip() {
  const warms = useDocOf(1, WarmsDoc)
  const now = useNow(60_000)
  const { data, refetch } = useAction(SummaryAction, null, {
    // A failed poll keeps the last summary; the next one asks again.
    onError: () => {},
  })
  useEffect(() => {
    // oxlint-disable-next-line typescript/no-floating-promises -- useAction reports failures and resolves undefined rather than rejecting.
    void refetch()
  }, [warms, Math.floor(now / 300_000), refetch])
  if (!data) return null
  const recent = data.last && now - data.last.at < 24 * 60 * 60_000
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Prompt cache misses"
          className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-sm px-1 transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          data-cache-chip
          type="button"
        >
          <RefreshCwIcon
            className={cn('size-3', recent && 'text-warning', data.failed && 'text-error')}
          />
          cache
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1 font-mono" side="top">
        <div className="px-2 pt-1 pb-1.5 section-label">Prompt cache · all conversations</div>
        <div className="space-y-1 border-t border-border/70 px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">
          <div className={cn(data.last ? 'text-warning' : 'text-foreground/80')}>
            {data.last
              ? `Last miss: ${formatAgo(data.last.at, now, { ago: true })} · ${dollars(data.last.missedCost)} · #${data.last.conversation}`
              : 'No cache miss yet'}
          </div>
          <div>
            Misses this week: {data.week.count} · {dollars(data.week.cost)}
          </div>
          <div>
            Warmed this week: {data.warmed.count} · {dollars(data.warmed.cost)}
          </div>
          {data.failed && (
            <div className="text-error">
              Last warm failed {formatAgo(data.failed.at, now, { ago: true })}
            </div>
          )}
          <div className="pt-1 text-muted-foreground/70">
            A miss writes the context to the cache again: after an idle hour, a model switch or a
            changed prompt.
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default defineWebExtension({
  entries: { 'pi.assistant': Reply },
  slots: { 'statusline.right': [{ component: Chip, order: -1 }] },
})
