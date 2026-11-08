import {
  ChevronRightIcon,
  FolderIcon,
  LayersIcon,
  LoaderCircleIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  actionRef,
  api,
  cn,
  defineWebExtension,
  docRef,
  events,
  errorMessage,
  formatAgo,
  Header,
  plural,
  shortenPath,
  StatusLine,
  useConversation,
  useDocOf,
  useEvent,
  useNow,
  useSystem,
  useUltimate,
} from '@/sdk'
import { tile } from '../project-icon/icon.ts'
import { useOverrides } from '../project-icon/use-overrides.ts'
import { looks } from '../tab-status/status.ts'
import { arrival, projectUrl, questionLine, totals, validName } from './model.ts'
import type { Folders, Overview, Row, RowState, Waiting } from './model.ts'

/** No arguments → every project on this machine with its instance's status (server.ts). */
const OverviewAction = actionRef<null, Overview>('projects', 'overview')
/** `{ root }` of a stopped project → `{ started }`. */
const StartAction = actionRef<{ root: string }, { started: string }>('projects', 'start')
/** `{ root }` of a running project other than this one → `{ stopping }`. */
const StopAction = actionRef<{ root: string }, { stopping: string }>('projects', 'stop')
/** No arguments → the roots and the folders in them that are not projects yet. */
const FoldersAction = actionRef<null, Folders>('projects', 'folders')
/** `{ path }` of a folder that is not a project yet → `{ started }`. */
const OpenAction = actionRef<{ path: string }, { started: string }>('projects', 'open')
/** `{ name, root }` → a new folder with git, started: `{ started, root }`. */
const CreateAction = actionRef<{ name: string; root: string }, { started: string; root: string }>(
  'projects',
  'create',
)
const HideAction = actionRef<{ root: string }, Record<string, never>>('projects', 'hide')
const UnhideAction = actionRef<{ root: string }, Record<string, never>>('projects', 'unhide')

const button =
  'h-7 cursor-pointer rounded-md px-2.5 whitespace-nowrap text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-40'
const quiet = cn(button, 'text-muted-foreground hover:text-foreground')

/** How often the counter and the surface ask again; faster while a project starts. */
const POLL_MS = 30_000
const STARTING_POLL_MS = 3000

/**
 * One overview poll per page, shared by the counter and the surface: the next call starts only after the last one
 * ended, so a slow instance never cancels or stacks polls. Runs while anything on the page reads it.
 */
const overview = (() => {
  let state: { data?: Overview; error?: unknown } = {}
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  const poll = async () => {
    clearTimeout(timer)
    if (running) return
    running = true
    try {
      state = { data: await api.action(OverviewAction) }
    } catch (error) {
      // The last overview stays shown with the error beside it; the next poll asks again.
      state = { ...state, error }
    }
    running = false
    for (const listener of listeners) listener()
    const starting = state.data?.rows.some(
      (row) => row.state === 'starting' || row.state === 'stopping',
    )
    if (listeners.size) timer = setTimeout(() => void poll(), starting ? STARTING_POLL_MS : POLL_MS)
  }
  return {
    get: () => state,
    refresh: () => void poll(),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      if (listeners.size === 1) void poll()
      return () => {
        listeners.delete(listener)
        if (!listeners.size) clearTimeout(timer)
      }
    },
  }
})()

const useOverview = () => useSyncExternalStore(overview.subscribe, overview.get)

/** The messages extension's `board` document: only what finds the response that asked a question. */
const BoardDoc = docRef<{
  messages: { id: number; from: number | string; call?: string }[]
}>('board')

/** `{ conversation, call }` → the entry of the response that made tool call `call` (messages' `caller`). */
const CallerAction = actionRef<{ conversation: number; call: string }, { entry?: number }>(
  'messages',
  'caller',
)

/** The question to scroll to once its conversation is shown and loaded. */
let pendingReveal: { conversation: number; call: string; message: number } | undefined
const REVEAL_EVENT = 'projects:reveal'

/**
 * Show question `message` where it was asked: its conversation, scrolled to the response that asked it. Returns false
 * when the board does not know it (answered meanwhile).
 */
function useOpenQuestion() {
  const board = useDocOf(1, BoardDoc)
  const { showSurface, switchConversation } = useUltimate()
  return (message: number) => {
    const asked = board?.messages.find((item) => item.id === message)
    if (typeof asked?.from !== 'number') return false
    if (asked.call) {
      pendingReveal = { conversation: asked.from, call: asked.call, message }
      events.emit(REVEAL_EVENT, null)
    }
    showSurface('agent')
    switchConversation(asked.from)
    return true
  }
}

/**
 * Scrolls to the pending question once its conversation is on screen and loaded; the transcript pages older history in
 * when the entry is not loaded yet.
 */
function Reveal() {
  const { id, loading } = useConversation()
  const { surface } = useUltimate()
  const [, rerender] = useState(0)
  useEvent(REVEAL_EVENT, () => rerender((count) => count + 1))
  const target = pendingReveal
  useEffect(() => {
    if (!target || surface !== 'agent' || id !== target.conversation || loading) return
    pendingReveal = undefined
    // Not cleared on re-render: the target is taken, and only these retries can still show it.
    const { conversation, call, message } = target
    api.action(CallerAction, { conversation, call }).then(
      ({ entry }) => {
        if (entry === undefined) return
        // The transcript pages the asking response in; its question card (messages' `data-message-outgoing`) sits
        // at its end, below what it says first. A freshly opened transcript still settles at its bottom after it
        // loads, undoing an early scroll: try again until the card is on screen, for about five seconds at most.
        let tries = 0
        const reveal = () => {
          const card = document.querySelector(`[data-message-outgoing="${message}"]`)
          const top = card?.getBoundingClientRect().top
          if (top !== undefined && top >= 0 && top < innerHeight / 2) return
          if (card) card.scrollIntoView({ block: 'start' })
          else
            events.emit('ultimate:reveal-entry', {
              conversationId: conversation,
              entryId: entry,
            })
          if (++tries < 12) setTimeout(reveal, 400)
        }
        reveal()
      },
      // The conversation is shown either way; only the scroll to the question is lost.
      () => undefined,
    )
  }, [target, surface, id, loading])
  return null
}

/** Go to a project in this window, at a question when given; within this project, without a reload. */
function useNavigate() {
  const { showSurface } = useUltimate()
  const openQuestion = useOpenQuestion()
  return (row: Row, question?: Pick<Waiting, 'conversation' | 'message'>) => {
    if (row.current) {
      if (!question || !openQuestion(question.message)) showSurface('agent')
      return
    }
    const url = projectUrl(location, row, question)
    if (url) location.href = url
  }
}

/** Arriving from another project's Projects: show the conversation (at the question), not where this project was left. */
function Arrival() {
  const { showSurface } = useUltimate()
  const board = useDocOf(1, BoardDoc)
  const openQuestion = useOpenQuestion()
  const [target, setTarget] = useState(() => arrival(location.hash))
  useEffect(() => {
    if (!target) return
    // A question waits for the board to load; one answered meanwhile leaves just its conversation shown.
    if (target.message !== undefined && !board) return
    if (target.message === undefined || !openQuestion(target.message)) showSurface('agent')
    history.replaceState(history.state, '', location.pathname + location.search)
    setTarget(undefined)
  }, [target, board, openQuestion, showSurface])
  return null
}

/** The status line's global counter: messages waiting on the user across every project. Opens Projects. */
function Counter() {
  const { data } = useOverview()
  const { showSurface } = useUltimate()
  if (!data) return null
  const { waiting, projects } = totals(data.rows)
  return (
    <button
      className={cn(
        '-mx-1 flex cursor-pointer items-center gap-1.5 rounded-sm px-1 transition-colors hover:bg-accent hover:text-foreground',
        waiting > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground/60',
      )}
      data-projects-waiting={waiting}
      onClick={() => showSurface('projects')}
      title="Messages waiting on you across every project on this machine. Opens Projects."
      type="button"
    >
      <span aria-hidden>◆</span>
      {waiting > 0 ? (
        <span>
          {waiting} waiting
          <span className="max-md:hidden"> in {plural(projects, 'project')}</span>
        </span>
      ) : (
        <span>0</span>
      )}
    </button>
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

function Dot({ state }: { state: RowState }) {
  if (state === 'stopped')
    return <span className="w-2 text-center text-muted-foreground/60">–</span>
  if (state === 'starting' || state === 'stopping')
    return <LoaderCircleIcon className="size-2.5 animate-spin text-muted-foreground" />
  const color = looks[state as keyof typeof looks]?.dot
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        !color && 'border border-muted-foreground/50',
        state === 'working' && 'animate-pulse-dot',
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
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

function ProjectRow({
  row,
  commands,
  pending,
  awaited,
}: {
  row: Row
  commands: Commands
  pending: boolean
  awaited: boolean
}) {
  const home = useSystem()?.machine.home
  const override = useOverrides()[row.name]
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const running = row.port !== undefined
  const stop = running && !row.current && row.state !== 'stopping' && (
    <button
      className={quiet}
      disabled={pending}
      onClick={() => (row.busy > 0 ? setConfirming(true) : commands.stop(row))}
      type="button"
    >
      Stop
    </button>
  )
  const action =
    row.state === 'stopping' ? null : running ? (
      row.current ? (
        <span className="px-2.5 text-muted-foreground/60">here</span>
      ) : (
        <button className={button} onClick={() => navigate(row)} type="button">
          Open
        </button>
      )
    ) : row.state === 'stopped' ? (
      <>
        <button
          className={button}
          disabled={pending}
          onClick={() => commands.start(row)}
          type="button"
        >
          Start
        </button>
        <button
          className={quiet}
          disabled={pending}
          onClick={() => commands.hide(row)}
          title="Leave it out of this list; its folder and conversations stay"
          type="button"
        >
          Hide
        </button>
      </>
    ) : row.state === 'starting' ? (
      <button
        className={cn(quiet, awaited && 'text-foreground')}
        disabled={awaited}
        onClick={() => commands.openWhenReady(row)}
        title="Opens it here as soon as it answers"
        type="button"
      >
        {awaited ? 'opening…' : 'Open when ready'}
      </button>
    ) : null
  return (
    <li
      className={cn(
        'grid grid-cols-[auto_1fr_auto] items-center gap-x-3 px-3 py-2 md:grid-cols-[auto_13rem_1fr_9rem_8.5rem]',
        row.current && 'bg-accent/40',
      )}
      data-project={row.name}
      data-state={row.state}
      title={row.error}
    >
      <span className="flex w-2 justify-center">
        <Dot state={row.state} />
      </span>
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
        <img alt="" className="size-[18px] shrink-0" src={tile(row.name, { override })} />
        <span className="truncate">{row.name}</span>
        {row.current && (
          <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
            this window
          </span>
        )}
      </span>
      <span className="col-start-2 row-start-2 min-w-0 truncate font-mono text-[11px] text-muted-foreground/70 md:col-start-auto md:row-start-auto">
        {shortenPath(row.root, { home })}
      </span>
      <span
        className={cn(
          'col-start-2 row-start-3 font-mono text-[11.5px] text-muted-foreground md:col-start-auto md:row-start-auto',
          tones[row.state],
        )}
      >
        {stateText(row)}
      </span>
      <span className="col-start-3 row-span-3 row-start-1 flex flex-col items-end font-mono text-[12px] md:col-start-auto md:row-span-1 md:row-start-auto md:flex-row md:justify-end">
        {stop}
        {action}
      </span>
      {confirming && (
        <div className="col-span-3 mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 font-mono text-[11.5px] text-amber-700 md:col-span-4 md:col-start-2 dark:text-amber-300">
          <span>{row.busy} busy · their runs stop now and resume on the next Start</span>
          <span className="ml-auto flex gap-1">
            <button className={quiet} onClick={() => setConfirming(false)} type="button">
              Cancel
            </button>
            <button
              className={cn(button, 'border border-border/70 text-red-600 dark:text-red-400')}
              onClick={() => {
                setConfirming(false)
                commands.stop(row)
              }}
              type="button"
            >
              Stop {row.name}
            </button>
          </span>
        </div>
      )}
    </li>
  )
}

/** Every Ultimate project on this machine, what each needs, and the questions waiting on the user across them. */
function Projects() {
  const { data, error } = useOverview()
  const navigate = useNavigate()
  const [startError, setStartError] = useState<string>()
  const [pending, setPending] = useState<string>()
  const now = useNow(60_000)
  const home = useSystem()?.machine.home
  const [adding, setAdding] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  /** The root to open as soon as its instance answers (Open when ready, or after Create and start). */
  const [awaited, setAwaited] = useState<string>()
  const run = (row: Pick<Row, 'name' | 'root'>, call: Promise<unknown>) => {
    setStartError(undefined)
    setPending(row.root)
    return call
      .then(() => overview.refresh())
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
  useEffect(() => {
    const row = awaited && data?.rows.find((item) => item.root === awaited)
    if (!row || row.port === undefined || row.state === 'unreachable') return
    if (!projectUrl(location, row)) return
    setAwaited(undefined)
    navigate(row)
  }, [awaited, data, navigate])
  const sum = data ? totals(data.rows) : undefined
  return (
    <>
      <Header>
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <LayersIcon className="size-4 text-muted-foreground" />
          Projects
        </span>
      </Header>
      <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {adding && (
          <section className="mx-auto max-w-4xl px-3 pt-3 md:px-5">
            <AddProject
              onClose={() => setAdding(false)}
              onStarted={(root) => {
                setAdding(false)
                setAwaited(root)
                overview.refresh()
              }}
            />
          </section>
        )}
        <section className="mx-auto max-w-4xl px-3 py-3 md:px-5">
          <div className="rounded-lg border border-border/70 bg-card/40">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              <span className="section-label">Projects</span>
              {sum && (
                <span className="ml-auto flex items-center gap-3">
                  <span className={cn(sum.waiting > 0 && tones['needs-you'])}>
                    {sum.waiting} waiting
                  </span>
                  <span>·</span>
                  <span className={cn(sum.working > 0 && tones.working)}>
                    {sum.working} working
                  </span>
                  {!adding && (
                    <button
                      className="flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border/70 px-2 text-foreground hover:bg-accent"
                      data-projects-add
                      onClick={() => setAdding(true)}
                      type="button"
                    >
                      <PlusIcon className="size-3" />
                      Add project
                    </button>
                  )}
                </span>
              )}
            </div>
            {!data ? (
              <p className="py-6 text-center font-mono text-[11.5px] text-muted-foreground/70">
                {error ? `overview failed: ${errorMessage(error)}` : 'loading…'}
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {data.rows.map((row) => (
                  <ProjectRow
                    awaited={awaited === row.root}
                    commands={commands}
                    key={row.root}
                    pending={pending === row.root}
                    row={row}
                  />
                ))}
              </ul>
            )}
            {data && data.hidden.length > 0 && (
              <div className="border-t border-border/70 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                <button
                  className="cursor-pointer hover:text-foreground"
                  onClick={() => setShowHidden(!showHidden)}
                  type="button"
                >
                  {showHidden ? 'hide' : 'show'} {data.hidden.length} hidden
                </button>
                {showHidden && (
                  <ul className="mt-1">
                    {data.hidden.map((item) => (
                      <li className="flex items-center gap-3 py-0.5" key={item.root}>
                        <span className="text-foreground">{item.name}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
                          {shortenPath(item.root, { home })}
                        </span>
                        <button
                          className={quiet}
                          disabled={pending === item.root}
                          onClick={() =>
                            void run(item, api.action(UnhideAction, { root: item.root }))
                          }
                          type="button"
                        >
                          Show
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {startError && (
              <p className="border-t border-border/70 px-3 py-2 font-mono text-[11.5px] text-red-600 dark:text-red-400">
                {startError}
              </p>
            )}
          </div>
        </section>
        {sum && sum.questions.length > 0 && (
          <section className="mx-auto max-w-4xl px-3 pb-6 md:px-5">
            <div className="py-1.5 section-label">Waiting on you, oldest first</div>
            <ul className="divide-y divide-border/50 rounded-lg border border-border/70 bg-card/40">
              {sum.questions.map((question) => (
                <li key={`${question.project.root}:${question.message}`}>
                  <button
                    className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-accent/50"
                    data-question={question.message}
                    onClick={() => navigate(question.project, question)}
                    type="button"
                  >
                    <span className="shrink-0 font-mono text-[11.5px] text-amber-700 dark:text-amber-300">
                      {question.project.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {questionLine(question.text)}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                      {formatAgo(question.at, now, { ago: true })}
                    </span>
                    <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <StatusLine />
    </>
  )
}

/**
 * Add project: open a folder under the roots that is not a project yet (most recent first, filtered as you type), or
 * create a new one there; either starts Ultimate in it and opens it once it answers.
 */
function AddProject({
  onClose,
  onStarted,
}: {
  onClose: () => void
  onStarted: (root: string) => void
}) {
  const home = useSystem()?.machine.home
  const now = useNow(60_000)
  const [mode, setMode] = useState<'open' | 'new'>('open')
  const [folders, setFolders] = useState<Folders>()
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [root, setRoot] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    api.action(FoldersAction).then(
      (value) => {
        setFolders(value)
        setRoot((current) => current ?? value.roots[0])
      },
      (error: unknown) => setFailure(errorMessage(error)),
    )
  }, [])
  useEffect(() => input.current?.focus(), [mode])
  const short = (path: string) => shortenPath(path, { home })
  const call = (key: string, action: Promise<{ root?: string }>, path: string) => {
    setBusy(key)
    setFailure(undefined)
    action.then(
      (result) => onStarted(result.root ?? path),
      (error: unknown) => {
        setFailure(errorMessage(error))
        setBusy(undefined)
      },
    )
  }
  const query = filter.trim().toLowerCase()
  const matches = (folders?.folders ?? []).filter((item) => item.name.toLowerCase().includes(query))
  const shown = matches.slice(0, 8)
  const target = root && name ? `${root}/${name}` : undefined
  const exists = folders?.folders.some((item) => item.path === target)
  const nameError =
    name && !validName(name)
      ? 'letters, digits, . _ and -, starting with a letter or digit'
      : exists
        ? `${short(target!)} already exists: open it instead`
        : undefined
  const tab = (value: typeof mode, label: string) => (
    <button
      className={cn(
        'cursor-pointer px-2.5 py-1',
        mode === value ? 'bg-accent text-foreground' : 'hover:text-foreground',
      )}
      onClick={() => setMode(value)}
      type="button"
    >
      {label}
    </button>
  )
  const field =
    'h-8 w-full min-w-0 rounded-md border border-border/70 bg-background/50 px-2.5 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-violet-400/60'
  return (
    <div className="rounded-lg border border-border/70 bg-card/40" data-projects-add-panel>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        <span className="section-label">Add project</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="inline-flex overflow-hidden rounded-md border border-border/70 text-[11.5px]">
            {tab('open', 'Open folder')}
            {tab('new', 'New project')}
          </span>
          <button
            aria-label="Close"
            className="cursor-pointer rounded-md p-1 hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      </div>
      {!folders ? (
        <p className="py-4 text-center font-mono text-[11.5px] text-muted-foreground/70">
          {failure ?? 'loading…'}
        </p>
      ) : folders.roots.length === 0 ? (
        <p className="px-3 py-3 font-mono text-[11.5px] text-muted-foreground">
          No projects root: add <code>"projects": {'{ "roots": ["~/code"] }'}</code> to
          ~/.ultimate/settings.json.
        </p>
      ) : mode === 'open' ? (
        <>
          <div className="px-3 pt-2.5 pb-1.5">
            <input
              className={field}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && shown[0] && !busy)
                  call(
                    shown[0].path,
                    api.action(OpenAction, { path: shown[0].path }),
                    shown[0].path,
                  )
              }}
              placeholder={`Filter folders in ${folders.roots.map(short).join(', ')}…`}
              ref={input}
              value={filter}
            />
          </div>
          <div className="px-3 pb-1 font-mono text-[11px] text-muted-foreground">
            Not a project yet · most recent first
          </div>
          <ul className="divide-y divide-border/50 border-t border-border/50">
            {shown.map((item) => (
              <li
                className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 px-3 py-1.5 md:grid-cols-[auto_1fr_auto_auto]"
                key={item.path}
              >
                <FolderIcon className="size-3.5 text-muted-foreground/70" />
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-[13px]">{item.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground/70 max-md:hidden">
                    {short(item.path)}
                  </span>
                  {!item.git && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                      no git
                    </span>
                  )}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground/70 max-md:hidden">
                  {formatAgo(item.at, now, { ago: true })}
                </span>
                <button
                  className={cn(button, 'font-mono text-[12px]')}
                  disabled={busy !== undefined}
                  onClick={() =>
                    call(item.path, api.action(OpenAction, { path: item.path }), item.path)
                  }
                  type="button"
                >
                  {busy === item.path ? 'starting…' : 'Start'}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border/50 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
            {matches.length > shown.length
              ? `${matches.length - shown.length} more · type to filter`
              : matches.length === 0
                ? 'no folder matches'
                : `${matches.length} shown`}
            {' · roots: '}
            {folders.roots.map(short).join(', ')}
          </div>
        </>
      ) : (
        <form
          className="grid gap-2 px-3 py-2.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!root || !name || nameError || busy) return
            call('new', api.action(CreateAction, { name, root }), `${root}/${name}`)
          }}
        >
          <label className="flex items-center gap-2">
            <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">Name</span>
            <input
              autoCapitalize="off"
              autoCorrect="off"
              className={field}
              onChange={(event) => setName(event.target.value.trim())}
              placeholder="my-app"
              ref={input}
              spellCheck={false}
              value={name}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">In</span>
            {folders.roots.map((item) => (
              <button
                className={cn(
                  'cursor-pointer rounded-full border px-2 py-0.5 font-mono text-[11px]',
                  item === root
                    ? 'border-violet-400/70 text-foreground'
                    : 'border-border/70 text-muted-foreground hover:text-foreground',
                )}
                key={item}
                onClick={() => setRoot(item)}
                type="button"
              >
                {short(item)}
              </button>
            ))}
          </div>
          <p
            className={cn(
              'min-h-4 pl-14 font-mono text-[11px]',
              nameError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
            )}
          >
            {nameError ??
              (target
                ? `creates ${short(target)} with git, then Ultimate's setup starts there`
                : '')}
          </p>
          <div className="flex justify-end gap-1 font-mono text-[12px]">
            <button className={quiet} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className={cn(button, 'bg-violet-500/25 hover:bg-violet-500/35')}
              disabled={!name || !!nameError || busy !== undefined}
              type="submit"
            >
              {busy === 'new' ? 'starting…' : 'Create and start'}
            </button>
          </div>
        </form>
      )}
      {failure && folders && (
        <p className="border-t border-border/70 px-3 py-2 font-mono text-[11.5px] text-red-600 dark:text-red-400">
          {failure}
        </p>
      )}
    </div>
  )
}

export default defineWebExtension({
  slots: {
    'statusline.right': [{ component: Counter, order: -4, phone: true }],
    overlay: [Arrival, Reveal],
  },
  surfaces: [
    {
      id: 'projects',
      title: 'Projects',
      icon: LayersIcon,
      description: 'Every Ultimate project on this machine, and what waits on you across them',
      order: 40,
      component: Projects,
    },
  ],
  commands: [
    {
      id: 'projects.open',
      title: 'Open Projects',
      run: (context) => context.showSurface('projects'),
    },
  ],
})
