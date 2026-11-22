/** @jsxImportSource @solidjs/web */
import { ChevronRight, Ellipsis, Folder, Layers, LoaderCircle, Plus, X } from '@lucide/solid'
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onSettled,
  Show,
  Switch,
} from 'solid-js'
import type { Accessor } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible.solid.tsx'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.solid.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.solid.tsx'
import { Form } from '@/components/ui/form.solid.tsx'
import { Input } from '@/components/ui/input.solid.tsx'
import { StatusButton } from '@/components/ui/status-trigger.solid.tsx'
import {
  ROOT,
  actionRef,
  api,
  cn,
  defineWebExtension,
  events,
  errorMessage,
  formatAgo,
  Header,
  keepLast,
  plural,
  prettyName,
  shortenPath,
  showSurface,
  StatusLine,
  switchConversation,
  useAction,
  useDocOf,
  useNow,
  useSystem,
  useViewport,
} from '@/sdk/solid'
import { ProjectSwatch } from '@/../../extensions/sidebar/ui.solid.tsx'
import { StandingDoc } from '@/../../extensions/subagents/refs.ts'
import { deadline } from '@/../../lib/timers.ts'
import type { Cancel } from '@/../../lib/timers.ts'
import { tile, useOverrides } from '../project-icon/ui.solid.tsx'
import { looks } from '../tab-status/ui.solid.tsx'
import { ARRIVAL, groups, projectUrl, totals, validName } from './model.ts'
import type { Folders, Overview, Row, RowState } from './model.ts'

/** No arguments → every project on this machine with its instance's status (server.ts). */
const OverviewAction = actionRef<null, Overview>('fleet', 'overview')
/** `{ root }` of a stopped project → `{ started }`. */
const StartAction = actionRef<{ root: string }, { started: string }>('fleet', 'start')
/** `{ root }` of a running project other than this one → `{ stopping }`. */
const StopAction = actionRef<{ root: string }, { stopping: string }>('fleet', 'stop')
/** No arguments → the roots and the folders in them that are not projects yet. */
const FoldersAction = actionRef<null, Folders>('fleet', 'folders')
/** `{ path }` of a folder that is not a project yet → `{ started }`. */
const OpenAction = actionRef<{ path: string }, { started: string }>('fleet', 'open')
/** `{ name, root }` → a new folder with git, started: `{ started, root }`. */
const CreateAction = actionRef<{ name: string; root: string }, { started: string; root: string }>(
  'fleet',
  'create',
)
const HideAction = actionRef<{ root: string }, Record<string, never>>('fleet', 'hide')
const UnhideAction = actionRef<{ root: string }, Record<string, never>>('fleet', 'unhide')

const button =
  'h-7 rounded-md px-2.5 text-[length:inherit] font-normal whitespace-nowrap text-foreground hover:bg-accent disabled:opacity-40'
const quiet = cn(button, 'text-muted-foreground hover:text-foreground')

/** How often the counter and the surface ask again; faster while a project starts. */
const POLL_MS = 30_000
const STARTING_POLL_MS = 3000

const useOverview = () =>
  useAction(OverviewAction, null, {
    conversation: ROOT,
    onError: keepLast,
    every: (data) =>
      data?.rows.some((row) => row.state === 'starting' || row.state === 'stopping')
        ? STARTING_POLL_MS
        : POLL_MS,
  })

/**
 * Go to a project's question or the project itself. Another project opens its page, at the question in its Inbox when
 * there is one; this project opens the question in its Inbox without a reload, else its @ultimate.
 */
function useNavigate() {
  const standing = useDocOf(() => ROOT, StandingDoc)
  return (row: Row, message?: number) => {
    if (!row.current) {
      const url = projectUrl(location, row, message)
      if (url) location.href = url
    } else if (message !== undefined) events.emit('inbox:open', { message })
    else {
      showSurface('agent')
      const ultimate = standing()?.ultimate
      if (ultimate !== undefined) switchConversation(ultimate)
    }
  }
}

/**
 * Arriving from another project's Fleet without a question: show the conversation, not Fleet, where the user
 * last left this project to go there. A question arrives as `?inbox=<message>`, which the inbox extension handles.
 */
function Arrival() {
  onSettled(() => {
    if (location.hash !== ARRIVAL) return
    showSurface('agent')
    history.replaceState(history.state, '', location.pathname + location.search)
  })
  return null
}

/** The status line's global counter: messages waiting on the user across every project. Opens Fleet. */
function Counter() {
  const overview = useOverview()
  const sum = createMemo(() => {
    const data = overview.data()
    return data && totals(data.rows)
  })
  return (
    <Show when={sum()}>
      {(total) => (
        <StatusButton
          aria-label={`Open Fleet: ${total().waiting} waiting`}
          class={
            total().waiting > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground/60'
          }
          data-fleet-waiting={total().waiting}
          onClick={() => showSurface('fleet')}
          title="Messages waiting on you across every project on this machine. Opens Fleet."
        >
          <span aria-hidden="true">◆</span>
          <Show when={total().waiting > 0} fallback={<span>0</span>}>
            <span>
              {total().waiting} waiting
              <span class="max-md:hidden"> in {plural(total().projects, 'project')}</span>
            </span>
          </Show>
        </StatusButton>
      )}
    </Show>
  )
}

/**
 * Phones only, where upstream's projects rail is off on purpose: the running projects at the top of the sidebar, each
 * with the rail's swatch, an amber count of what waits on the user and a dot while it works. Folded to one line while
 * nothing waits; a tap on a row opens that project, as Fleet's rows do.
 */
function PhoneProjects() {
  const viewport = useViewport()
  const overview = useOverview()
  const navigate = useNavigate()
  const [folded, setFolded] = createSignal<boolean>()
  const rows = createMemo(
    () => overview.data()?.rows.filter((row) => row.current || row.port !== undefined) ?? [],
  )
  const sum = createMemo(() => totals(rows()))
  const family = createMemo(() => rows().map((row) => row.name))
  const open = () => !(folded() ?? sum().waiting === 0)
  return (
    // Like the rail: with only this project running there is nothing to switch to.
    <Show when={viewport() === 'phone' && rows().length >= 2}>
      <Collapsible
        aria-label="Projects"
        class="flex shrink-0 flex-col gap-px border-b border-border/60 pt-1.5 pb-1"
        data-fleet-projects
        onOpenChange={(next) => setFolded(!next)}
        open={open()}
      >
        <CollapsibleTrigger class="group/projects mx-2 flex h-6 items-center gap-1 rounded-md px-1 section-label outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
          <ChevronRight class="size-3 transition-transform group-data-open/projects:rotate-90" />
          Projects
          <span class="ml-0.5 text-muted-foreground/60 tabular-nums">{rows().length}</span>
          <Show when={!open() && (sum().waiting > 0 || sum().working > 0)}>
            <span class={cn('ml-auto', sum().waiting > 0 ? tones['needs-you'] : tones.working)}>
              {sum().waiting > 0 ? `${sum().waiting} for you` : `${sum().working} working`}
            </span>
          </Show>
        </CollapsibleTrigger>
        <CollapsibleContent class="flex flex-col gap-px">
          <For each={rows()} keyed={(row) => row.root}>
            {(row) => (
              <Button
                aria-label={`Open ${row().name}`}
                class="mx-2 flex h-8 min-w-0 items-center justify-start gap-2.5 rounded-md pr-2 pl-2.5 text-left font-normal outline-none hover:bg-sidebar-accent/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-45"
                data-fleet-project={row().name}
                disabled={!row().current && !projectUrl(location, row())}
                onClick={() => navigate(row())}
                size={null}
                variant={null}
              >
                <ProjectSwatch
                  class="h-4 w-1.5 rounded-full"
                  family={family()}
                  folder={row().name}
                />
                <span
                  class={cn(
                    'min-w-0 flex-1 truncate text-[13px]',
                    row().current ? 'font-semibold text-foreground' : 'text-foreground/85',
                  )}
                >
                  {prettyName(row().name)}
                </span>
                <Show
                  when={row().waiting.length > 0}
                  fallback={
                    <Show when={row().busy > 0}>
                      <span class="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-brand" />
                    </Show>
                  }
                >
                  <span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 px-1.5 font-mono text-[10px] font-semibold text-amber-700 tabular-nums ring-1 ring-amber-500/30 ring-inset dark:text-amber-300">
                    {row().waiting.length}
                  </span>
                </Show>
              </Button>
            )}
          </For>
        </CollapsibleContent>
      </Collapsible>
    </Show>
  )
}

/** What a row's state says, after its dot. */
function stateText(row: Row) {
  switch (row.state) {
    case 'needs-you':
      return `${row.waiting.length} waiting${row.busy > 0 ? ` · ${row.busy} busy` : ''}`
    case 'failed':
      return 'failed'
    case 'working':
      return `working · ${row.busy} busy`
    case 'answer':
      return 'new answer'
    case 'idle':
      return 'idle'
    case 'stopped':
      return 'stopped'
    case 'starting':
      return 'starting…'
    case 'stopping':
      return 'stopping…'
    default:
      return 'not answering'
  }
}

const tones: Partial<Record<RowState, string>> = {
  'needs-you': 'text-amber-700 dark:text-amber-300',
  failed: 'text-red-600 dark:text-red-400',
  working: 'text-violet-600 dark:text-violet-300',
  answer: 'text-green-600 dark:text-green-400',
}

function Dot(props: { state: RowState }) {
  const color = () => looks[props.state as keyof typeof looks]?.dot
  return (
    <Switch
      fallback={
        <span
          class={cn(
            'inline-block size-2 shrink-0 rounded-full',
            !color() && 'border border-muted-foreground/50',
            props.state === 'working' && 'animate-pulse-dot',
          )}
          style={{ 'background-color': color() }}
        />
      }
    >
      <Match when={props.state === 'stopped'}>
        <span class="w-2 text-center text-muted-foreground/60">–</span>
      </Match>
      <Match when={props.state === 'starting' || props.state === 'stopping'}>
        <LoaderCircle class="size-2.5 animate-spin text-muted-foreground" />
      </Match>
    </Switch>
  )
}

/** Row commands, run by the surface: each reports its failure in the list's error line. */
type Commands = {
  start: (row: Row) => void
  stop: (row: Row) => void
  hide: (row: Row) => void
  /** Open the row once its instance answers: its new @ultimate, where a new project's setup waits. */
  openWhenReady: (row: Row) => void
}

/** How far a swipe pulls a phone row left to show its action, and how far it must go to stay open. */
const SWIPE_PX = 88
const SWIPE_OPEN = SWIPE_PX * 0.4
/** Movement under this is still a tap or a long press; past it the drag is locked to one direction. */
const SLOP_PX = 10
const LONG_PRESS_MS = 500

/**
 * A phone row's touch handling: swipe left to reveal its action, long press for its sheet. The row has `touch-action:
 * pan-y`, so a vertical drag scrolls natively and never reaches the swipe; a horizontal one locks after `SLOP_PX`. A
 * click that ends a swipe or a long press is swallowed so it does not also open the row.
 */
function useSwipe(enabled: Accessor<boolean>, onLongPress: () => void) {
  const [offset, setOffset] = createSignal(0)
  const [dragging, setDragging] = createSignal(false)
  let gesture:
    | { x: number; y: number; base: number; mode: 'pending' | 'swipe' | 'scroll' }
    | undefined
  let cancelPress: Cancel | undefined
  let swallow = false
  let area: HTMLLIElement | undefined
  const close = () => setOffset(0)
  const resting = createMemo(() => enabled() && offset() !== 0 && !dragging())
  // An open row closes on a touch anywhere else or on Escape, as iOS lists do.
  createEffect(resting, (active) => {
    if (!active) return undefined
    const outside = (event: PointerEvent) => {
      if (!area?.contains(event.target as Node)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  })
  onSettled(() => () => cancelPress?.())
  const end = () => {
    cancelPress?.()
    const mode = gesture?.mode
    gesture = undefined
    if (mode !== 'swipe') return
    swallow = true
    setDragging(false)
    setOffset((value) => (value < -SWIPE_OPEN ? -SWIPE_PX : 0))
  }
  const handlers = {
    onPointerDown: (event: PointerEvent) => {
      if (!enabled() || event.pointerType === 'mouse') return
      swallow = false
      gesture = { x: event.clientX, y: event.clientY, base: offset(), mode: 'pending' }
      cancelPress?.()
      cancelPress = deadline(LONG_PRESS_MS, () => {
        if (gesture?.mode !== 'pending') return
        gesture = undefined
        swallow = true
        close()
        onLongPress()
      })
    },
    onPointerMove: (event: PointerEvent) => {
      const current = gesture
      if (!current || current.mode === 'scroll') return
      const dx = event.clientX - current.x
      const dy = event.clientY - current.y
      if (current.mode === 'pending') {
        if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return
        cancelPress?.()
        current.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll'
        // Touch pointers are captured by the row they started on already: no setPointerCapture.
        if (current.mode === 'scroll') return
        setDragging(true)
      }
      setOffset(Math.max(-SWIPE_PX * 1.25, Math.min(0, current.base + dx)))
    },
    onPointerUp: end,
    onPointerCancel: end,
    onContextMenu: (event: MouseEvent) => {
      if (enabled()) event.preventDefault()
    },
  }
  // The click a swipe or long press ends with does nothing; a tap on an open row only closes it, like iOS.
  const swallowClicks = (element: HTMLElement) =>
    element.addEventListener(
      'click',
      (event) => {
        if (!enabled()) return
        const swallowed = swallow
        if (!swallowed && offset() === 0) return
        swallow = false
        event.preventDefault()
        event.stopPropagation()
        if (!swallowed) close()
      },
      { capture: true },
    )
  return {
    area: (element: HTMLLIElement) => {
      area = element
    },
    offset: () => (enabled() ? offset() : 0),
    dragging: () => enabled() && dragging(),
    open: () => enabled() && offset() !== 0,
    close,
    handlers,
    swallowClicks,
  }
}

type SheetAction = { text: string; run: () => void; tone?: string }

/** A phone row's long-press actions as a bottom sheet, the same ones its swipe and the desktop's buttons offer. */
function ActionSheet(props: {
  title: string
  actions: (SheetAction | false)[]
  onClose: () => void
}) {
  const item =
    'block h-auto min-h-12 w-full rounded-none border-t border-border/60 px-4 text-left text-[15px] font-normal active:bg-accent'
  const actions = () => props.actions.filter((action) => action !== false)
  return (
    <Dialog onOpenChange={(open) => !open && props.onClose()} open>
      <DialogContent
        backdropClass="bg-black/50"
        class="top-auto right-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-2 w-auto max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-xl border-border/70 bg-popover p-0 shadow-none sm:max-w-none"
        data-fleet-sheet
        showCloseButton={false}
      >
        <DialogTitle class="px-4 py-2.5 font-mono text-[11px] leading-normal font-normal text-muted-foreground">
          {props.title}
        </DialogTitle>
        <For each={actions()} keyed={(action) => action.text}>
          {(action) => (
            <Button
              class={cn(item, action().tone)}
              onClick={() => {
                props.onClose()
                action().run()
              }}
              size={null}
              variant={null}
            >
              {action().text}
            </Button>
          )}
        </For>
        <Button
          aria-label={`Cancel: keep ${props.title}`}
          class={cn(item, 'text-muted-foreground')}
          onClick={() => props.onClose()}
          size={null}
          variant={null}
        >
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function ProjectRow(props: { row: Row; commands: Commands; pending: boolean; awaited: boolean }) {
  const system = useSystem()
  const home = () => system()?.machine.home
  const overrides = useOverrides()
  const navigate = useNavigate()
  const viewport = useViewport()
  const phone = () => viewport() === 'phone'
  const [confirming, setConfirming] = createSignal(false)
  const [sheet, setSheet] = createSignal(false)
  const running = () => props.row.port !== undefined
  const canStop = () => running() && !props.row.current && props.row.state !== 'stopping'
  const stopped = () => props.row.state === 'stopped'
  const stop = () => (props.row.busy > 0 ? setConfirming(true) : props.commands.stop(props.row))
  /** What a tap on the row does: open it, or start it and open it once it answers. */
  const tap = createMemo(() => {
    if (running()) return props.row.state === 'stopping' ? undefined : 'open'
    if (stopped()) return 'start'
    return props.row.state === 'starting' ? 'await' : undefined
  })
  const primary = () => {
    const row = props.row
    const action = tap()
    if (action === 'open') navigate(row, groups([row])[0]?.questions[0].message)
    if (action === 'start') props.commands.start(row)
    if (action === 'start' || action === 'await') props.commands.openWhenReady(row)
  }
  const label = () => {
    const name = props.row.name
    if (props.row.waiting.length) return `Open ${name}'s Inbox at its oldest question`
    if (props.row.current) return `Open @ultimate in ${name}`
    if (running()) return `Open ${name}`
    return stopped() ? `Start and open ${name}` : `Open ${name} when ready`
  }
  // The phone row's swipe action: the one thing it does besides opening.
  const swiped = createMemo((): SheetAction | undefined => {
    if (canStop()) return { text: 'Stop', run: stop, tone: 'bg-amber-700 text-white' }
    if (stopped())
      return {
        text: 'Hide',
        run: () => props.commands.hide(props.row),
        tone: 'bg-zinc-600 text-white',
      }
    return undefined
  })
  const swipe = useSwipe(
    () => phone() && !!swiped(),
    () => setSheet(true),
  )
  const status = () => (
    <span class={cn('font-mono text-[11.5px] text-muted-foreground', tones[props.row.state])}>
      {stateText(props.row)}
      {props.awaited && ' · opens when ready'}
    </span>
  )
  return (
    <li
      class="relative overflow-hidden"
      data-project={props.row.name}
      data-state={props.row.state}
      ref={swipe.area}
      title={props.row.error}
    >
      <Show when={phone() && swiped()}>
        {(action) => (
          <Button
            aria-hidden={swipe.open() ? undefined : 'true'}
            aria-label={`${action().text} ${props.row.name} (swiped)`}
            class={cn(
              'absolute inset-y-0 right-0 flex h-auto items-center justify-center rounded-none text-[13px] font-semibold',
              action().tone,
            )}
            data-swipe-action
            disabled={props.pending}
            onClick={() => {
              swipe.close()
              action().run()
            }}
            size={null}
            style={{ width: `${SWIPE_PX}px` }}
            tabindex={swipe.open() ? 0 : -1}
            variant={null}
          >
            {action().text}
          </Button>
        )}
      </Show>
      <div
        class={cn(
          'relative flex items-stretch bg-card',
          phone() && 'touch-pan-y select-none [-webkit-touch-callout:none]',
          !swipe.dragging() && 'transition-transform duration-200',
        )}
        ref={swipe.swallowClicks}
        style={{ transform: swipe.offset() ? `translateX(${swipe.offset()}px)` : undefined }}
        {...swipe.handlers}
      >
        <Button
          aria-label={label()}
          class={cn(
            'grid h-auto min-h-14 min-w-0 flex-1 grid-cols-[auto_1fr_auto] items-center justify-normal gap-x-3 gap-y-0 rounded-none px-3 py-2 text-left text-[length:inherit] font-normal whitespace-normal outline-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-100 disabled:hover:bg-transparent md:min-h-11 md:grid-cols-[auto_13rem_1fr_9rem_auto]',
            props.row.current && 'bg-accent/40',
          )}
          data-project-open
          disabled={!tap() || (stopped() && props.pending)}
          onClick={primary}
          size={null}
          variant={null}
        >
          <span class="flex w-2 justify-center">
            <Dot state={props.row.state} />
          </span>
          <span class="min-w-0">
            <span class="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
              <img
                alt=""
                class="size-[18px] shrink-0"
                src={tile(props.row.name, { override: overrides()[props.row.name] })}
              />
              <span class="truncate">{props.row.name}</span>
              <Show when={props.row.current}>
                <span class="shrink-0 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                  this window
                </span>
              </Show>
            </span>
            <span class="mt-0.5 flex min-w-0 gap-1.5 md:hidden">
              {status()}
              <span class="min-w-0 truncate font-mono text-[11px] leading-[17px] text-muted-foreground/70">
                · {shortenPath(props.row.root, { home: home() })}
              </span>
            </span>
          </span>
          <span class="min-w-0 truncate font-mono text-[11px] text-muted-foreground/70 max-md:hidden">
            {shortenPath(props.row.root, { home: home() })}
          </span>
          <span class="max-md:hidden">{status()}</span>
          <ChevronRight class={cn('size-3.5 text-muted-foreground/60', !tap() && 'invisible')} />
        </Button>
        <Show when={!phone()}>
          <span class="flex w-36 shrink-0 items-center justify-end gap-0.5 border-l border-border/50 px-2 font-mono text-[12px]">
            <Show when={canStop()}>
              <Button
                aria-label={`Stop ${props.row.name}`}
                class={quiet}
                disabled={props.pending}
                onClick={stop}
                size={null}
                variant={null}
              >
                Stop
              </Button>
            </Show>
            <Show when={stopped()}>
              <Button
                aria-label={`Start ${props.row.name}`}
                class={cn(button, 'border border-border/70')}
                disabled={props.pending}
                onClick={() => props.commands.start(props.row)}
                size={null}
                title="Start it and stay here"
                variant={null}
              >
                Start
              </Button>
              <DropdownMenu onAction={() => props.commands.hide(props.row)}>
                <DropdownMenuTrigger
                  aria-label={`More for ${props.row.name}`}
                  class={cn(quiet, 'inline-flex items-center px-1.5')}
                  disabled={props.pending}
                >
                  <Ellipsis class="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="font-mono">
                  <DropdownMenuItem class="text-[12px]" value="hide">
                    Hide from this list
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Show>
          </span>
        </Show>
      </div>
      <Show when={sheet()}>
        <ActionSheet
          actions={[
            canStop() && { text: `Stop ${props.row.name}`, run: stop, tone: tones['needs-you'] },
            stopped() && {
              text: `Start ${props.row.name}`,
              run: () => props.commands.start(props.row),
            },
            stopped() && { text: 'Hide from this list', run: () => props.commands.hide(props.row) },
          ]}
          onClose={() => setSheet(false)}
          title={props.row.name}
        />
      </Show>
      <Show when={confirming()}>
        <div class="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 font-mono text-[11.5px] text-amber-700 md:ml-8 dark:text-amber-300">
          <span>{props.row.busy} busy · their runs stop now and resume on the next Start</span>
          <span class="ml-auto flex gap-1">
            <Button
              aria-label={`Cancel stopping ${props.row.name}`}
              class={quiet}
              onClick={() => setConfirming(false)}
              size={null}
              variant={null}
            >
              Cancel
            </Button>
            <Button
              aria-label={`Stop ${props.row.name} and its busy runs`}
              class={cn(button, 'border border-border/70 text-red-600 dark:text-red-400')}
              onClick={() => {
                setConfirming(false)
                props.commands.stop(props.row)
              }}
              size={null}
              variant={null}
            >
              Stop {props.row.name}
            </Button>
          </span>
        </div>
      </Show>
    </li>
  )
}

/** Every Ultimate project on this machine and what each needs; their waiting questions are in the Inbox. */
function Fleet() {
  const overview = useOverview()
  const navigate = useNavigate()
  const [startError, setStartError] = createSignal<string>()
  const [pending, setPending] = createSignal<string>()
  const system = useSystem()
  const home = () => system()?.machine.home
  const [adding, setAdding] = createSignal(false)
  const [showHidden, setShowHidden] = createSignal(false)
  /** The root to open as soon as its instance answers (Open when ready, or after Create and start). */
  const [awaited, setAwaited] = createSignal<string>()
  const run = (row: Pick<Row, 'name' | 'root'>, call: Promise<unknown>) => {
    setStartError(undefined)
    setPending(row.root)
    return call
      .then(() => overview.refetch())
      .catch((failure: unknown) => setStartError(`${row.name}: ${errorMessage(failure)}`))
      .finally(() => setPending(undefined))
  }
  const commands: Commands = {
    start: (row) => void run(row, api.action(StartAction, { root: row.root })),
    stop: (row) => void run(row, api.action(StopAction, { root: row.root })),
    hide: (row) => void run(row, api.action(HideAction, { root: row.root })),
    openWhenReady: (row) => setAwaited(row.root),
  }
  // Opens the awaited project once it answers, and on the tailnet once it has its tailnet port too.
  createEffect(
    () => {
      const root = awaited()
      return root === undefined
        ? undefined
        : overview.data()?.rows.find((item) => item.root === root)
    },
    (row) => {
      if (!row || row.port === undefined || row.state === 'unreachable') return
      if (!projectUrl(location, row)) return
      setAwaited(undefined)
      navigate(row)
    },
  )
  const sum = createMemo(() => {
    const data = overview.data()
    return data && totals(data.rows)
  })
  return (
    <>
      <Header>
        <span class="flex items-center gap-2 text-[13px] font-medium">
          <Layers class="size-4 text-muted-foreground" />
          Fleet
        </span>
      </Header>
      <main class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <Show when={adding()}>
          <section class="mx-auto max-w-4xl px-3 pt-3 md:px-5">
            <AddProject
              onClose={() => setAdding(false)}
              onStarted={(root) => {
                setAdding(false)
                setAwaited(root)
                void overview.refetch()
              }}
            />
          </section>
        </Show>
        <section class="mx-auto max-w-4xl px-3 py-3 md:px-5">
          <div class="rounded-lg border border-border/70 bg-card/40">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              <span class="section-label">Projects</span>
              <Show when={sum()}>
                {(total) => (
                  <span class="ml-auto flex items-center gap-3">
                    <span class={cn(total().waiting > 0 && tones['needs-you'])}>
                      {total().waiting} waiting
                    </span>
                    <span>·</span>
                    <span class={cn(total().working > 0 && tones.working)}>
                      {total().working} working
                    </span>
                    <Show when={!adding()}>
                      <Button
                        class="flex h-6 items-center gap-1 rounded-md border border-border/70 px-2 text-[length:inherit] font-normal text-foreground hover:bg-accent"
                        data-fleet-add
                        onClick={() => setAdding(true)}
                        size={null}
                        variant={null}
                      >
                        <Plus class="size-3" />
                        Add project
                      </Button>
                    </Show>
                  </span>
                )}
              </Show>
            </div>
            <Show
              when={overview.data()}
              fallback={
                <p class="py-6 text-center font-mono text-[11.5px] text-muted-foreground/70">
                  {overview.error()
                    ? `overview failed: ${errorMessage(overview.error())}`
                    : 'loading…'}
                </p>
              }
            >
              {(data) => (
                <ul class="divide-y divide-border/50">
                  <For each={data().rows} keyed={(row) => row.root}>
                    {(row) => (
                      <ProjectRow
                        awaited={awaited() === row().root}
                        commands={commands}
                        pending={pending() === row().root}
                        row={row()}
                      />
                    )}
                  </For>
                </ul>
              )}
            </Show>
            <Show when={overview.data()?.hidden.length ? overview.data()?.hidden : undefined}>
              {(hidden) => (
                <div class="border-t border-border/70 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                  <Button
                    class="h-auto rounded-none p-0 text-[length:inherit] font-normal hover:text-foreground"
                    onClick={() => setShowHidden(!showHidden())}
                    size={null}
                    variant={null}
                  >
                    {`${showHidden() ? 'hide' : 'show'} ${hidden().length} hidden`}
                  </Button>
                  <Show when={showHidden()}>
                    <ul class="mt-1">
                      <For each={hidden()} keyed={(item) => item.root}>
                        {(item) => (
                          <li class="flex items-center gap-3 py-0.5">
                            <span class="text-foreground">{item().name}</span>
                            <span class="min-w-0 flex-1 truncate text-muted-foreground/70">
                              {shortenPath(item().root, { home: home() })}
                            </span>
                            <Button
                              aria-label={`Show ${item().name}`}
                              class={quiet}
                              disabled={pending() === item().root}
                              onClick={() =>
                                void run(item(), api.action(UnhideAction, { root: item().root }))
                              }
                              size={null}
                              variant={null}
                            >
                              Show
                            </Button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={startError()}>
              <p class="border-t border-border/70 px-3 py-2 font-mono text-[11.5px] text-red-600 dark:text-red-400">
                {startError()}
              </p>
            </Show>
          </div>
        </section>
      </main>
      <StatusLine />
    </>
  )
}

/**
 * Add project: open a folder under the roots that is not a project yet (most recent first, filtered as you type), or
 * create a new one there; either starts Ultimate in it and opens it once it answers.
 */
function AddProject(props: { onClose: () => void; onStarted: (root: string) => void }) {
  const system = useSystem()
  const now = useNow(60_000)
  const [mode, setMode] = createSignal<'open' | 'new'>('open')
  const [folders, setFolders] = createSignal<Folders>()
  const [filter, setFilter] = createSignal('')
  const [name, setName] = createSignal('')
  const [root, setRoot] = createSignal<string>()
  const [busy, setBusy] = createSignal<string>()
  const [failure, setFailure] = createSignal<string>()
  let input: HTMLInputElement | undefined
  onSettled(() => {
    api.action(FoldersAction, null).then(
      (value) => {
        setFolders(value)
        setRoot((current) => current ?? value.roots[0])
      },
      (error: unknown) => setFailure(errorMessage(error)),
    )
  })
  createEffect(mode, () => input?.focus())
  const short = (path: string) => shortenPath(path, { home: system()?.machine.home })
  const call = (key: string, action: Promise<{ started: string; root?: string }>, path: string) => {
    setBusy(key)
    setFailure(undefined)
    action.then(
      (result) => props.onStarted(result.root ?? path),
      (error: unknown) => {
        setFailure(errorMessage(error))
        setBusy(undefined)
      },
    )
  }
  const open = (path: string) => call(path, api.action(OpenAction, { path }), path)
  const matches = createMemo(() => {
    const query = filter().trim().toLowerCase()
    return (folders()?.folders ?? []).filter((item) => item.name.toLowerCase().includes(query))
  })
  const shown = createMemo(() => matches().slice(0, 8))
  const target = () => {
    const parent = root()
    return parent && name() ? `${parent}/${name()}` : undefined
  }
  const nameError = () => {
    if (name() && !validName(name()))
      return 'letters, digits, . _ and -, starting with a letter or digit'
    const path = target()
    if (path && folders()?.folders.some((item) => item.path === path))
      return `${short(path)} already exists: open it instead`
    return undefined
  }
  const tab = (value: 'open' | 'new', label: string) => (
    <Button
      class={cn(
        'h-auto rounded-none px-2.5 py-1 text-[length:inherit] font-normal',
        mode() === value ? 'bg-accent text-foreground' : 'hover:text-foreground',
      )}
      onClick={() => setMode(value)}
      size={null}
      variant={null}
    >
      {label}
    </Button>
  )
  const field =
    'h-8 border-border/70 bg-background/50 px-2.5 text-foreground placeholder:text-muted-foreground/70 focus-visible:border-violet-400/60 focus-visible:ring-0'
  return (
    <div class="rounded-lg border border-border/70 bg-card/40" data-fleet-add-panel>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        <span class="section-label">Add project</span>
        <span class="ml-auto flex items-center gap-2">
          <span class="inline-flex overflow-hidden rounded-md border border-border/70 text-[11.5px]">
            {tab('open', 'Open folder')}
            {tab('new', 'New project')}
          </span>
          <Button
            aria-label="Close Add project"
            class="h-auto rounded-md p-1 font-normal hover:bg-accent hover:text-foreground"
            onClick={() => props.onClose()}
            size={null}
            variant={null}
          >
            <X class="size-3.5" />
          </Button>
        </span>
      </div>
      <Show
        when={folders()}
        fallback={
          <p class="py-4 text-center font-mono text-[11.5px] text-muted-foreground/70">
            {failure() ?? 'loading…'}
          </p>
        }
      >
        {(list) => (
          <Switch>
            <Match when={list().roots.length === 0}>
              <p class="px-3 py-3 font-mono text-[11.5px] text-muted-foreground">
                No fleet root: add <code>"fleet": {'{ "roots": ["~/code"] }'}</code> to
                ~/.ultimate/settings.json.
              </p>
            </Match>
            <Match when={mode() === 'open'}>
              <div class="px-3 pt-2.5 pb-1.5">
                <Input
                  aria-label="Filter folders"
                  class={field}
                  onKeyDown={(event: KeyboardEvent) => {
                    const first = shown()[0]
                    if (event.key === 'Enter' && first && !busy()) open(first.path)
                  }}
                  onValueChange={setFilter}
                  placeholder={`Filter folders in ${list().roots.map(short).join(', ')}…`}
                  ref={(element: HTMLInputElement) => {
                    input = element
                  }}
                  value={filter()}
                />
              </div>
              <div class="px-3 pb-1 font-mono text-[11px] text-muted-foreground">
                Not a project yet · most recent first
              </div>
              <ul class="divide-y divide-border/50 border-t border-border/50">
                <For each={shown()} keyed={(item) => item.path}>
                  {(item) => (
                    <li class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 px-3 py-1.5 md:grid-cols-[auto_1fr_auto_auto]">
                      <Folder class="size-3.5 text-muted-foreground/70" />
                      <span class="flex min-w-0 items-baseline gap-2">
                        <span class="truncate text-[13px]">{item().name}</span>
                        <span class="truncate font-mono text-[11px] text-muted-foreground/70 max-md:hidden">
                          {short(item().path)}
                        </span>
                        <Show when={!item().git}>
                          <span class="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                            no git
                          </span>
                        </Show>
                      </span>
                      <span class="font-mono text-[11px] text-muted-foreground/70 max-md:hidden">
                        {formatAgo(item().at, now(), { ago: true })}
                      </span>
                      <Button
                        aria-label={`Start Ultimate in ${item().name}`}
                        class={cn(button, 'font-mono text-[12px]')}
                        disabled={busy() !== undefined}
                        onClick={() => open(item().path)}
                        size={null}
                        variant={null}
                      >
                        {busy() === item().path ? 'starting…' : 'Start'}
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
              <div class="border-t border-border/50 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                {matches().length > shown().length
                  ? `${matches().length - shown().length} more · type to filter`
                  : matches().length === 0
                    ? 'no folder matches'
                    : `${matches().length} shown`}
                {' · roots: '}
                {list().roots.map(short).join(', ')}
              </div>
            </Match>
            <Match when={mode() === 'new'}>
              <Form class="grid gap-2 px-3 py-2.5">
                <label class="flex items-center gap-2">
                  <span class="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">
                    Name
                  </span>
                  <Input
                    autocapitalize="off"
                    autocorrect="off"
                    class={field}
                    onValueChange={(value: string) => setName(value.trim())}
                    placeholder="my-app"
                    ref={(element: HTMLInputElement) => {
                      input = element
                    }}
                    value={name()}
                  />
                </label>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">In</span>
                  <For each={list().roots}>
                    {(item) => (
                      <Button
                        aria-label={`Create in ${short(item)}`}
                        class={cn(
                          'h-auto rounded-full border px-2 py-0.5 font-mono text-[11px] font-normal',
                          item === root()
                            ? 'border-violet-400/70 text-foreground'
                            : 'border-border/70 text-muted-foreground hover:text-foreground',
                        )}
                        onClick={() => setRoot(item)}
                        size={null}
                        variant={null}
                      >
                        {short(item)}
                      </Button>
                    )}
                  </For>
                </div>
                <p
                  class={cn(
                    'min-h-4 pl-14 font-mono text-[11px]',
                    nameError() ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                  )}
                >
                  {nameError() ??
                    (target()
                      ? `creates ${short(target()!)} with git, then Ultimate's setup starts there`
                      : '')}
                </p>
                <div class="flex justify-end gap-1 font-mono text-[12px]">
                  <Button
                    aria-label="Cancel Add project"
                    class={quiet}
                    onClick={() => props.onClose()}
                    size={null}
                    variant={null}
                  >
                    Cancel
                  </Button>
                  <Button
                    class={cn(button, 'bg-violet-500/25 hover:bg-violet-500/35')}
                    disabled={!name() || !!nameError() || busy() !== undefined}
                    onClick={() => {
                      const parent = root()
                      if (!parent || !name() || nameError() || busy()) return
                      call(
                        'new',
                        api.action(CreateAction, { name: name(), root: parent }),
                        `${parent}/${name()}`,
                      )
                    }}
                    size={null}
                    type="submit"
                    variant={null}
                  >
                    {busy() === 'new' ? 'starting…' : 'Create and start'}
                  </Button>
                </div>
              </Form>
            </Match>
          </Switch>
        )}
      </Show>
      <Show when={failure() && folders()}>
        <p class="border-t border-border/70 px-3 py-2 font-mono text-[11.5px] text-red-600 dark:text-red-400">
          {failure()}
        </p>
      </Show>
    </div>
  )
}

export default defineWebExtension({
  slots: {
    'statusline.right': [{ component: Counter, order: -4, phone: true }],
    // Before the sidebar's own project header, so the drawer opens on where else you can go.
    sidebar: [{ component: PhoneProjects, order: -10 }],
    overlay: [Arrival],
  },
  surfaces: [
    {
      id: 'fleet',
      title: 'Fleet',
      icon: Layers,
      description: 'Every Ultimate project on this machine, and what waits on you across them',
      order: 40,
      component: Fleet,
    },
  ],
  commands: [
    {
      id: 'fleet.open',
      title: 'Open Fleet',
      run: (context) => context.showSurface('fleet'),
    },
  ],
})
