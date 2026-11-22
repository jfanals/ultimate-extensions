/** @jsxImportSource @solidjs/web */
import { Flame, RefreshCw } from '@lucide/solid'
import type { JSX } from '@solidjs/web'
import { createMemo, For, Show } from 'solid-js'
import { Popover, PopoverContent } from '@/components/ui/popover.solid.tsx'
import { StatusPopoverTrigger } from '@/components/ui/status-trigger.solid.tsx'
import {
  ROOT,
  actionRef,
  cn,
  defineWebExtension,
  docRef,
  formatAgo,
  formatTime,
  keepLast,
  useAction,
  useDocOf,
  useNow,
  useTranscript,
} from '@/sdk/solid'
import type { SolidEntryProps } from '@/sdk/solid'
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

/** How often the pings and the summary are asked again without a new ping: a settings change shows within it. */
const REFRESH_MS = 300_000

/** A quiet divider across the transcript, as `models` marks a switch: rules either side of a short line. */
function Divider(props: { tone: string; title: string; children: JSX.Element }) {
  return (
    <div
      class={cn(
        'flex items-center gap-3 font-mono text-[11px] before:h-px before:flex-1 before:bg-border/70 after:h-px after:flex-1 after:bg-border/70',
        props.tone,
      )}
      data-cache-note
      title={props.title}
    >
      <span class="flex max-w-[80%] min-w-0 items-center gap-1.5">
        <Flame class="size-3 shrink-0" />
        <span class="truncate">{props.children}</span>
      </span>
    </div>
  )
}

/** Pings between this reply and the next, grey; a failed one red. */
function WarmLines(props: { warms: Warm[] }) {
  const ok = () => props.warms.filter((warm) => warm.error === undefined)
  const failed = () => props.warms.filter((warm) => warm.error !== undefined)
  return (
    <>
      <Show when={warmText(props.warms)}>
        {(text) => (
          <Divider
            title={`keep-warm renewed @ultimate's prompt cache while it was idle (cost of its cache read and write): ${ok()
              .map((warm) => formatTime(warm.at))
              .join(', ')}`}
            tone="text-muted-foreground/60"
          >
            {text()}
          </Divider>
        )}
      </Show>
      <For each={failed()} keyed={(warm) => warm.at}>
        {(warm) => (
          <Divider
            title="keep-warm's ping failed; no more pings until @ultimate's next answer"
            tone="text-error"
          >
            {failText(warm())}
          </Divider>
        )}
      </For>
    </>
  )
}

/**
 * A reply: the keep-warm pings after it below. Compact mode can split a reply into rows of its blocks: the last. Every
 * row of a conversation shares one read of its pings; a new ping or the refresh interval asks again.
 */
function Reply(props: SolidEntryProps) {
  const pinged = useDocOf(() => ROOT, WarmsDoc)
  const { data: found } = useAction(
    WarmsAction,
    {
      get conversation() {
        return props.entry.conversationId
      },
    },
    {
      conversation: ROOT,
      onError: keepLast,
      on: () => pinged()?.warms.at(-1)?.at,
      every: REFRESH_MS,
    },
  )
  const entries = useTranscript()
  const warms = createMemo(() => {
    const all = found()
    if (!all?.length) return []
    const blockCount =
      (props.entry.model?.[0] as { content?: unknown[] } | undefined)?.content?.length ?? 0
    if (props.blocks && !props.blocks.includes(blockCount - 1)) return []
    const replies = entries().flatMap((item) => {
      const message = item.model?.[0]
      return item.conversationId === props.entry.conversationId &&
        item.kind === 'pi.assistant' &&
        message
        ? [{ id: item.id, at: message.timestamp }]
        : []
    })
    return all.filter((warm) => warmAnchor(replies, warm) === props.entry.id)
  })
  return (
    <Show fallback={props.core} when={warms().length}>
      <div class="flex flex-col gap-3">
        {props.core}
        <WarmLines warms={warms()} />
      </div>
    </Show>
  )
}

/** The status-line chip: the last rebuild and this week's, amber after a miss, red after a failed ping. */
function Chip() {
  const warms = useDocOf(() => ROOT, WarmsDoc)
  const now = useNow(60_000)
  const { data } = useAction(SummaryAction, null, {
    conversation: ROOT,
    onError: keepLast,
    on: warms,
    every: REFRESH_MS,
  })
  return (
    <Show when={data()}>
      {(summary) => {
        const recent = () => {
          const last = summary().last
          return !!last && now() - last.at < 24 * 60 * 60_000
        }
        return (
          <Popover>
            <StatusPopoverTrigger aria-label="Prompt cache misses" data-cache-chip>
              <RefreshCw
                class={cn('size-3', recent() && 'text-warning', summary().failed && 'text-error')}
              />
              cache
            </StatusPopoverTrigger>
            <PopoverContent align="end" class="w-64 p-1 font-mono" side="top">
              <div class="px-2 pt-1 pb-1.5 section-label">Prompt cache · all conversations</div>
              <div class="space-y-1 border-t border-border/70 px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">
                <Show
                  fallback={<div class="text-foreground/80">No cache miss yet</div>}
                  when={summary().last}
                >
                  {(last) => (
                    <div class="text-warning">
                      {`Last miss: ${formatAgo(last().at, now(), { ago: true })} · ${dollars(last().missedCost)} · #${last().conversation}`}
                    </div>
                  )}
                </Show>
                <div>
                  Misses this week: {summary().week.count} · {dollars(summary().week.cost)}
                </div>
                <div>
                  Warmed this week: {summary().warmed.count} · {dollars(summary().warmed.cost)}
                </div>
                <Show when={summary().failed}>
                  {(failed) => (
                    <div class="text-error">
                      Last warm failed {formatAgo(failed().at, now(), { ago: true })}
                    </div>
                  )}
                </Show>
                <div class="pt-1 text-muted-foreground/70">
                  A miss writes the context to the cache again: after an idle hour, a model switch
                  or a changed prompt.
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )
      }}
    </Show>
  )
}

export default defineWebExtension({
  entries: { 'pi.assistant': Reply },
  slots: { 'statusline.right': [{ component: Chip, order: -1 }] },
})
