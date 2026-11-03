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
import { dollars, failText, missText, warmAnchor, warmText } from './notice.ts'
import type { Miss, Settings, Warm } from './notice.ts'

type Notes = { settings: Settings; misses: Miss[]; warms: Warm[] }
type Summary = {
  last?: Miss & { conversation: number }
  week: { count: number; cost: number }
  warmed: { count: number; cost: number }
  failed?: Warm
}

const NotesAction = actionRef<{ conversation: number }, Notes>('prompt-cache', 'notes')
const SummaryAction = actionRef<null, Summary>('prompt-cache', 'summary')
const WarmsDoc = docRef<{ warms: Warm[] }>('cache.warms')

/**
 * Each conversation's notes, fetched once per newest entry: every row of a transcript reads the same answer, and a new
 * entry (a reply that may have paid), a new ping or a five-minute tick (a settings change) asks again.
 */
const notes = new Map<number, { key: string; value?: Notes }>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function useNotes(conversation: number, newest: number, warmed: number) {
  const tick = Math.floor(useNow(60_000) / 300_000)
  const key = `${newest}:${warmed}:${tick}`
  useEffect(() => {
    if (notes.get(conversation)?.key === key) return
    const value = notes.get(conversation)?.value
    notes.set(conversation, { key, ...(value ? { value } : {}) })
    api
      .action(NotesAction, { conversation })
      .then((fresh) => {
        if (notes.get(conversation)?.key !== key) return
        notes.set(conversation, { key, value: fresh })
        for (const listener of listeners) listener()
      })
      // The notes stay as they were; the next entry asks again.
      .catch((error: unknown) => console.warn('Cache notes', error))
  }, [conversation, key])
  return useSyncExternalStore(subscribe, () => notes.get(conversation)?.value)
}

/** Notes of the entry's conversation, as its transcript has loaded it. */
function useEntryNotes(entry: EntryRecord) {
  const entries = useTranscript()
  const warmed = useDocOf(1, WarmsDoc)?.warms.at(-1)?.at ?? 0
  return useNotes(entry.conversationId, entries.at(-1)?.id ?? 0, warmed)
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

const MissLine = ({ miss }: { miss: Miss }) => (
  <Divider
    icon={<RefreshCwIcon className="size-3 shrink-0" />}
    title={`The next reply wrote ${miss.missedTokens.toLocaleString()} tokens to the prompt cache again instead of reading them: about ${dollars(miss.missedCost)} more than a cache hit.`}
    tone="text-warning"
  >
    {missText(miss)}
  </Divider>
)

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

/** After an input: the miss of the reply it started. */
function AfterInput({ entry, core }: { entry: EntryRecord; core: ReactNode }) {
  const found = useEntryNotes(entry)?.misses.find(
    (miss) => miss.anchor === entry.id && miss.reply !== entry.id,
  )
  if (!found) return core
  return (
    <div className="flex flex-col gap-3">
      {core}
      <MissLine miss={found} />
    </div>
  )
}

/**
 * A reply: its miss above it when no input row carries it, the keep-warm pings after it below. Compact mode can split a
 * reply into rows of some of its blocks: the miss goes with the first, the pings with the last.
 */
function Reply({
  entry,
  core,
  blocks,
}: {
  entry: EntryRecord
  core: ReactNode
  blocks?: readonly number[]
}) {
  const found = useEntryNotes(entry)
  const entries = useTranscript()
  if (!found) return core
  const blockCount = (entry.model?.[0] as { content?: unknown[] } | undefined)?.content?.length ?? 0
  const first = !blocks || blocks.includes(0)
  const last = !blocks || blocks.includes(blockCount - 1)
  // Above the reply when no input row of the kinds below carries it (an input of another kind, or none).
  const miss = found.misses.find(
    (item) =>
      first &&
      item.reply === entry.id &&
      !inputs.includes(
        entries.find((row) => row.id === item.anchor && item.anchor !== entry.id)?.kind ?? '',
      ),
  )
  let warms: Warm[] = []
  if (last && found.warms.length) {
    const replies = entries.flatMap((item) => {
      const message = item.model?.[0]
      return item.conversationId === entry.conversationId && item.kind === 'pi.assistant' && message
        ? [{ id: item.id, at: message.timestamp }]
        : []
    })
    warms = found.warms.filter((warm) => warmAnchor(replies, warm) === entry.id)
  }
  if (!miss && warms.length === 0) return core
  return (
    <div className="flex flex-col gap-3">
      {miss && <MissLine miss={miss} />}
      {core}
      {warms.length > 0 && <WarmLines warms={warms} />}
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

/** Rows an input that starts a reply shows as. */
const inputs = [
  'pi.user',
  'drive.spoken',
  'board.message',
  'board.reply',
  'subagents.instruction',
  'subagents.report',
  'workspaces.lander-report',
]

export default defineWebExtension({
  entries: {
    ...Object.fromEntries(inputs.map((kind) => [kind, AfterInput])),
    'pi.assistant': Reply,
  },
  slots: { 'statusline.right': [{ component: Chip, order: -1 }] },
})
