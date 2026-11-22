/** @jsxImportSource @solidjs/web */
import type { JSX } from '@solidjs/web'
import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { Accessor } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { actionRef, api, useAgent, useSystem } from '@/sdk/solid'
import { batch } from '@/../../lib/timers.ts'
import { TextDialog } from './text.solid.tsx'
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
const gather = batch(GATHER_MS, () => void flush())

/** Ask whether `path` exists, in the next batch, unless a fresh answer is known; returns the cancel. */
function ask(path: string, done: () => void) {
  const answer = known.get(path)
  if (answer && Date.now() - answer.at < FRESH_MS) return undefined
  let spans = waiting.get(path)
  if (!spans) waiting.set(path, (spans = new Set()))
  spans.add(done)
  gather()
  return () => {
    spans.delete(done)
    if (!spans.size && waiting.get(path) === spans) waiting.delete(path)
  }
}

async function flush() {
  const asked = new Map(waiting)
  waiting.clear()
  if (!asked.size) return
  const found = await api.action(ExistsAction, { paths: [...asked.keys()] }).then(
    (paths) => new Set(paths),
    // Spans stay plain code when the check fails; nothing is remembered, so the next showing asks again.
    () => undefined,
  )
  if (!found) return
  const at = Date.now()
  for (const [path, spans] of asked) {
    known.set(path, { exists: found.has(path), at })
    for (const done of spans) done()
  }
}

/** Whether `path` names a text file the viewer opens: false until the batched check answers. */
function useExists(path: Accessor<string | undefined>) {
  const [answers, setAnswers] = createSignal(0)
  createEffect(path, (asked) => (asked ? ask(asked, () => setAnswers((n) => n + 1)) : undefined))
  return () => {
    answers()
    const asked = path()
    return asked !== undefined && known.get(asked)?.exists === true
  }
}

/**
 * An inline code span that names a text file which exists, relative to the shown conversation's folder, under `~/` or
 * absolute, as a quiet link that opens the viewer. Anything else stays the span it was.
 */
export function PathCode(props: { code: string; core: JSX.Element }) {
  const agent = useAgent()
  const system = useSystem()
  const path = createMemo(() => {
    const info = system()
    return info
      ? resolvePath(props.code, {
          cwd: agent().cwd ?? info.execution.defaultCwd,
          home: info.machine.home,
        })
      : undefined
  })
  const exists = useExists(path)
  const [open, setOpen] = createSignal(false)
  return (
    <Show when={exists() && path()} fallback={props.core}>
      {(file) => (
        <>
          <Button
            aria-haspopup="dialog"
            class="inline h-auto rounded-sm p-0 align-baseline text-[length:inherit] [font-weight:inherit] whitespace-normal underline decoration-muted-foreground/40 decoration-dotted underline-offset-[3px] transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            data-ui="media-path"
            onClick={() => setOpen(true)}
            size={null}
            title={`Open ${file()}`}
            variant={null}
          >
            {props.core}
          </Button>
          <TextDialog onOpenChange={setOpen} open={open()} path={file()} />
        </>
      )}
    </Show>
  )
}
