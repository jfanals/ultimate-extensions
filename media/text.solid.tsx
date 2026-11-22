/** @jsxImportSource @solidjs/web */
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  FileCodeIcon,
  FileTextIcon,
  FileXIcon,
  XIcon,
} from '@lucide/solid'
import type { JSX } from '@solidjs/web'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { createEffect, createMemo, createSignal, Match, Show, Switch } from 'solid-js'
import { unified } from 'unified'
import { HighlightedCode, Markdown } from '@/components/markdown/markdown.solid.tsx'
import { Button } from '@/components/ui/button.solid.tsx'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.solid.tsx'
import {
  actionRef,
  api,
  cn,
  elidePath,
  errorMessage,
  formatBytes,
  notify,
  shortenPath,
  useCopy,
  useSystem,
} from '@/sdk/solid'
import { InfoAction } from './load.ts'
import { resolveLink } from './types.ts'

type Text = { size: number; lines?: number; text: string; truncated: boolean }
/**
 * `{ path, all? }` → the text file as it is on disk now: its first 2,000 lines within 200 KB, or up to 5 MB; null once
 * it is gone (server.ts).
 */
const TextAction = actionRef<{ path: string; all?: boolean }, Text | null>('media', 'text')
/** `{ path }`: opens the file in Zed on the machine Ultimate runs on (server.ts). */
const EditAction = actionRef<{ path: string }, { editor: string }>('media', 'edit')

type Info =
  | { kind: 'checking' }
  | { kind: 'ready'; size: number; lines?: number }
  | { kind: 'missing' }
  | { kind: 'failed'; reason: string }
type Body =
  | { kind: 'loading' }
  | { kind: 'shown'; text: Text; all: boolean }
  | { kind: 'failed'; reason: string }

/** Zed opens on the machine Ultimate runs on, so only a page on that machine offers it. */
const onHost = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path)
const meta = (size: number, lines?: number) =>
  lines === undefined
    ? formatBytes(size)
    : `${formatBytes(size)} · ${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}`
/** The highlighter's language for `path`: its extension, or its name (`Dockerfile`); Shiki resolves the aliases. */
const languageOf = (path: string) => {
  const extension = path.split('/').at(-1)!.toLowerCase().split('.').at(-1)!
  return ({ h: 'c', hpp: 'cpp' } as Record<string, string>)[extension] ?? extension
}

/**
 * The file's text while `shown`, read afresh each time it shows (closing forgets it). `onRead` gets each read, or
 * undefined once the file is gone.
 */
function useText(
  path: () => string,
  shown: () => boolean,
  onRead: () => ((text: Text | undefined) => void) | undefined,
) {
  const [body, setBody] = createSignal<Body>()
  createEffect(
    () => ({ file: path(), open: shown(), read: onRead() }),
    ({ file, open, read }) => {
      if (!open) {
        setBody(undefined)
        return undefined
      }
      const controller = new AbortController()
      setBody({ kind: 'loading' })
      api.action(TextAction, { path: file }, { signal: controller.signal }).then(
        (text) => {
          read?.(text ?? undefined)
          setBody(
            text
              ? { kind: 'shown', text, all: false }
              : { kind: 'failed', reason: 'File no longer exists' },
          )
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setBody({ kind: 'failed', reason: errorMessage(error) })
        },
      )
      return () => controller.abort()
    },
  )
  const loadAll = () =>
    api.action(TextAction, { path: path(), all: true }).then(
      (text) =>
        setBody(
          text
            ? { kind: 'shown', text, all: true }
            : { kind: 'failed', reason: 'File no longer exists' },
        ),
      (error: unknown) => notify({ level: 'error', message: errorMessage(error) }),
    )
  return { body, loadAll }
}

/**
 * A link to a text file on this machine, as a one-line chip in the text, like a `#id` mention: an icon and the link's
 * label, with the path, size and lines on hover. It opens the full-screen viewer, which reads the file as it is now.
 */
export function TextCard(props: { path: string; label: string }) {
  const [info, setInfo] = createSignal<Info>({ kind: 'checking' })
  const [open, setOpen] = createSignal(false)
  const system = useSystem()
  const onRead = (text: Text | undefined) => {
    setInfo(text ? { kind: 'ready', size: text.size, lines: text.lines } : { kind: 'missing' })
    if (!text) setOpen(false)
  }

  createEffect(
    () => props.path,
    (path) => {
      let live = true
      api.action(InfoAction, { path }).then(
        (file) =>
          live &&
          setInfo(
            file ? { kind: 'ready', size: file.size, lines: file.lines } : { kind: 'missing' },
          ),
        (error: unknown) => live && setInfo({ kind: 'failed', reason: errorMessage(error) }),
      )
      return () => {
        live = false
      }
    },
  )

  const where = () => shortenPath(props.path, { home: system()?.machine.home })
  const gone = () => info().kind === 'missing' || info().kind === 'failed'
  const title = () => {
    const now = info()
    return now.kind === 'missing'
      ? `${where()} · File no longer exists`
      : now.kind === 'failed'
        ? `${where()} · ${now.reason}`
        : now.kind === 'ready'
          ? `${where()} · ${meta(now.size, now.lines)}`
          : where()
  }
  const content = () => (
    <>
      <Switch fallback={<FileCodeIcon class={icon} />}>
        <Match when={gone()}>
          <FileXIcon class={icon} />
        </Match>
        <Match when={isMarkdown(props.path)}>
          <FileTextIcon class={icon} />
        </Match>
      </Switch>
      <span class={cn(gone() && 'line-through decoration-foreground/30')}>{props.label}</span>
    </>
  )
  return (
    <Show
      when={!gone()}
      fallback={
        <span class={cn(chip, 'text-muted-foreground')} data-ui="media-text" title={title()}>
          {content()}
        </span>
      }
    >
      <Button
        aria-haspopup="dialog"
        class={cn(
          chip,
          'inline h-auto py-0 leading-[18px] text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
        )}
        data-ui="media-text"
        onClick={() => setOpen(true)}
        size={null}
        title={title()}
        variant={null}
      >
        {content()}
      </Button>
      <TextDialog onOpenChange={setOpen} onRead={onRead} open={open()} path={props.path} />
    </Show>
  )
}

const icon = 'mr-1 inline size-3 align-[-1px] text-muted-foreground'

/**
 * The transcript's inline chip, as `#id` mentions and preview links draw it, but inline text rather than a box, so the
 * punctuation after it stays on its line; it never breaks inside.
 */
const chip =
  'rounded-sm bg-muted/60 px-1.5 py-0.5 font-mono text-[11.5px] leading-5 font-normal whitespace-nowrap'

/**
 * The full-screen viewer of a text file: what a link chip and a path in inline code open. It fills a phone's screen
 * and reads the file each time it opens.
 */
export function TextDialog(props: {
  path: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRead?: (text: Text | undefined) => void
}) {
  const { body, loadAll } = useText(
    () => props.path,
    () => props.open,
    () => props.onRead,
  )
  const system = useSystem()
  const name = () => props.path.split('/').at(-1) ?? props.path
  const shown = () => {
    const now = body()
    return now?.kind === 'shown' ? now.text : undefined
  }
  return (
    <Dialog onOpenChange={(open) => props.onOpenChange(open)} open={props.open}>
      <DialogContent
        class="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-border/80 bg-terminal p-0 sm:h-[90vh] sm:w-[min(64rem,calc(100vw-4rem))] sm:max-w-none sm:rounded-lg"
        initialFocus="content"
        showCloseButton={false}
      >
        <span class="flex items-center gap-1 border-b border-border/60 py-1.5 pr-1.5 pl-3">
          <span class="min-w-0 flex-1">
            <DialogTitle class="truncate text-[13px] leading-5 font-normal text-foreground/90">
              {name()}
            </DialogTitle>
            <span class="block truncate font-mono text-[11px] leading-4 text-muted-foreground">
              <Show when={shown()}>{(text) => `${meta(text().size, text().lines)} · `}</Show>
              {elidePath(shortenPath(props.path, { home: system()?.machine.home }), 60)}
            </span>
          </span>
          <Show when={shown()}>{(text) => <CopyButton text={text().text} />}</Show>
          <Show when={onHost}>
            <IconButton label="Open in Zed" onClick={() => edit(props.path)}>
              <CodeIcon class="size-4" />
            </IconButton>
          </Show>
          <IconButton label="Close" onClick={() => props.onOpenChange(false)}>
            <XIcon class="size-4" />
          </IconButton>
        </span>
        <div class="min-h-0 flex-1 overflow-auto">
          <Contents body={body()} loadAll={loadAll} path={props.path} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The file's text: Markdown rendered as the transcript renders it, anything else highlighted with line numbers. */
function Contents(props: { body?: Body; path: string; loadAll: () => void }) {
  const shown = () => (props.body?.kind === 'shown' ? props.body : undefined)
  return (
    <Switch>
      <Match when={props.body?.kind === 'failed' && props.body}>
        {(failed) => (
          <span class="block px-3 py-2 text-[12px] text-destructive/80">{failed().reason}</span>
        )}
      </Match>
      <Match when={shown()}>
        {(body) => (
          <span class="block">
            <Show
              when={isMarkdown(props.path)}
              fallback={
                <pre class="shiki m-0 px-3 py-2 font-mono text-[12px] leading-[1.6]">
                  <HighlightedCode
                    code={body().text.text}
                    language={languageOf(props.path)}
                    lineNumbers
                  />
                </pre>
              }
            >
              <MarkdownFile path={props.path} text={body().text.text} />
            </Show>
            <Show when={body().text.truncated}>
              <span class="flex items-center gap-2 border-t border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                Showing {formatBytes(new TextEncoder().encode(body().text.text).length)} of{' '}
                {formatBytes(body().text.size)}
                <Show when={!body().all}>
                  <Button
                    class="h-auto p-0 font-mono text-[11px] font-normal text-brand hover:underline"
                    onClick={() => props.loadAll()}
                    size={null}
                    variant={null}
                  >
                    Load all
                  </Button>
                </Show>
              </span>
            </Show>
          </span>
        )}
      </Match>
      <Match when={true}>
        <span class="block px-3 py-2 text-[12px] text-muted-foreground">Reading…</span>
      </Match>
    </Switch>
  )
}

const markdownTree = unified().use(remarkParse).use(remarkGfm)

type Mdast = {
  type: string
  url?: string
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: Mdast[]
}

/**
 * `text`, a Markdown file in `folder`, with each relative link, image and link definition pointing at the file beside
 * it, as an absolute path: the transcript's Markdown hardens links for messages, which would turn `../README.md` into
 * `/README.md` and block `docs/plan.md`.
 */
function resolveLinks(text: string, folder: string) {
  const edits: { at: number; from: string; to: string }[] = []
  const walk = (node: Mdast) => {
    if (node.url !== undefined && node.position?.start.offset !== undefined) {
      const to = resolveLink(node.url, folder)
      const start = node.position.start.offset
      const at = destination(text.slice(start, node.position.end.offset), node.type, node.url)
      if (to !== node.url && at >= 0) edits.push({ at: start + at, from: node.url, to })
    }
    node.children?.forEach(walk)
  }
  walk(markdownTree.parse(text))
  return edits.reduceRight(
    (result, edit) => result.slice(0, edit.at) + edit.to + result.slice(edit.at + edit.from.length),
    text,
  )
}

/** Where the destination `url` starts in `source`, a link's, image's or definition's Markdown, or -1 if written otherwise. */
function destination(source: string, type: string, url: string) {
  if (type === 'definition') return source.indexOf(url, source.indexOf(']:'))
  const bare = source.lastIndexOf(`(${url}`)
  if (bare >= 0) return bare + 1
  const angled = source.lastIndexOf(`(<${url}`)
  return angled >= 0 ? angled + 2 : -1
}

/**
 * A Markdown file rendered as the transcript renders messages, except that relative links resolve against the file's
 * folder.
 */
function MarkdownFile(props: { path: string; text: string }) {
  const text = createMemo(() =>
    resolveLinks(props.text, props.path.slice(0, props.path.lastIndexOf('/'))),
  )
  return (
    <span class="mx-auto block max-w-3xl px-3.5 py-2.5">
      <Markdown text={text()} />
    </span>
  )
}

const edit = (path: string) =>
  void api
    .action(EditAction, { path })
    .catch((error: unknown) => notify({ level: 'error', message: errorMessage(error) }))

function CopyButton(props: { text: string }) {
  const { copied, copy } = useCopy()
  return (
    <IconButton label="Copy" onClick={() => copy(props.text)}>
      <Show when={copied()} fallback={<CopyIcon class="size-4" />}>
        <CheckIcon class="size-4" />
      </Show>
    </IconButton>
  )
}

function IconButton(props: { label: string; onClick: () => unknown; children: JSX.Element }) {
  return (
    <Button
      aria-label={props.label}
      class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      onClick={() => props.onClick()}
      size={null}
      title={props.label}
      variant={null}
    >
      {props.children}
    </Button>
  )
}
