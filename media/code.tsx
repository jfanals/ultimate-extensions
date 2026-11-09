import { useEffect, useReducer, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { actionRef, api, useConversation, useSystem } from '@/sdk'
import { TextDialog } from './text.tsx'
import { resolvePath } from './types.ts'

/** `{ paths }` → the absolute paths among them that name text files the viewer opens (server.ts). */
const ExistsAction = actionRef<{ paths: string[] }, string[]>('media', 'exists')

/** How long an answer counts before a newly shown span asks again. */
const FRESH_MS = 30_000
/** How long spans gather before one request asks about all of them. */
const GATHER_MS = 150

/** Each asked path's answer and when it came; shown spans keep using an old one while a new one is asked. */
const known = new Map<string, { exists: boolean; at: number }>()
/** Paths waiting for the next request, with the spans to tell. */
const waiting = new Map<string, Set<() => void>>()
let timer: ReturnType<typeof setTimeout> | undefined

/** Ask whether `path` exists, in the next batch, unless a fresh answer is known; returns the cancel. */
function ask(path: string, done: () => void) {
  const answer = known.get(path)
  if (answer && Date.now() - answer.at < FRESH_MS) return undefined
  let spans = waiting.get(path)
  if (!spans) waiting.set(path, (spans = new Set()))
  spans.add(done)
  timer ??= setTimeout(flush, GATHER_MS)
  return () => {
    spans.delete(done)
    if (!spans.size && waiting.get(path) === spans) waiting.delete(path)
  }
}

async function flush() {
  timer = undefined
  const batch = new Map(waiting)
  waiting.clear()
  if (!batch.size) return
  const found = await api.action(ExistsAction, { paths: [...batch.keys()] }).then(
    (paths) => new Set(paths),
    // Spans stay plain code when the check fails; nothing is remembered, so the next showing asks again.
    () => undefined,
  )
  if (!found) return
  const at = Date.now()
  for (const [path, spans] of batch) {
    known.set(path, { exists: found.has(path), at })
    for (const done of spans) done()
  }
}

/** Whether `path` names a text file the viewer opens: false until the batched check answers. */
function useExists(path: string | undefined) {
  const [, answered] = useReducer((count: number) => count + 1, 0)
  useEffect(() => (path ? ask(path, answered) : undefined), [path])
  return path !== undefined && known.get(path)?.exists === true
}

/**
 * An inline code span that names a text file which exists, relative to the shown conversation's folder, under `~/` or
 * absolute, as a quiet link that opens the viewer. Anything else stays the span it was.
 */
export function PathCode({ code, core }: { code: string; core: ReactNode }) {
  const cwd = useConversation((conversation) => conversation.agent.cwd)
  const system = useSystem()
  const path = system
    ? resolvePath(code, {
        cwd: cwd ?? system.execution.defaultCwd,
        home: system.machine.home,
      })
    : undefined
  const exists = useExists(path)
  const [open, setOpen] = useState(false)
  if (!path || !exists) return core
  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    setOpen(true)
  }
  return (
    <>
      <span
        aria-haspopup="dialog"
        className="cursor-pointer rounded-sm underline decoration-muted-foreground/40 decoration-dotted underline-offset-[3px] transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        data-ui="media-path"
        onClick={() => setOpen(true)}
        onKeyDown={keyDown}
        role="button"
        tabIndex={0}
        title={`Open ${path}`}
      >
        {core}
      </span>
      <TextDialog onOpenChange={setOpen} open={open} path={path} />
    </>
  )
}
