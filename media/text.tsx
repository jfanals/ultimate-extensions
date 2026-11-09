import {
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  CopyIcon,
  ExpandIcon,
  FileCodeIcon,
  FileTextIcon,
  FileXIcon,
  LoaderCircleIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { defaultRemarkPlugins } from 'streamdown'
import { CodeBlock, languageFromPath } from '@/components/ai/code-block'
import { MessageResponse } from '@/components/ai/message'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  actionRef,
  api,
  cn,
  elidePath,
  errorMessage,
  formatBytes,
  shortenPath,
  useCopy,
  useSystem,
} from '@/sdk'
import { store } from '@/sdk/client'
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

/**
 * The file's text while `shown`, read afresh each time it shows (closing forgets it). `onRead` gets each read, or
 * undefined once the file is gone.
 */
function useText(path: string, shown: boolean, onRead?: (text: Text | undefined) => void) {
  const [body, setBody] = useState<Body>()
  const read = useEffectEvent((text: Text | undefined) => onRead?.(text))
  useEffect(() => {
    const controller = new AbortController()
    if (!shown) {
      setBody(undefined)
      return () => controller.abort()
    }
    setBody({ kind: 'loading' })
    api.action(TextAction, { path }, { signal: controller.signal }).then(
      (text) => {
        read(text ?? undefined)
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
  }, [shown, path])
  const loadAll = () =>
    api.action(TextAction, { path, all: true }).then(
      (text) =>
        setBody(
          text
            ? { kind: 'shown', text, all: true }
            : { kind: 'failed', reason: 'File no longer exists' },
        ),
      (error: unknown) => store.notify({ level: 'error', message: errorMessage(error) }),
    )
  return { body, loadAll }
}

/**
 * A link to a text file on this machine, as a card: its name, size and lines. Opening it, inline or full screen, reads
 * the file as it is on disk now.
 */
export function TextCard({ path, label }: { path: string; label: ReactNode }) {
  const [info, setInfo] = useState<Info>({ kind: 'checking' })
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const name = path.split('/').at(-1) ?? path
  const Icon = isMarkdown(path) ? FileTextIcon : FileCodeIcon
  const onRead = (text: Text | undefined) => {
    if (text) return setInfo({ kind: 'ready', size: text.size, lines: text.lines })
    setInfo({ kind: 'missing' })
    setOpen(false)
    setFull(false)
  }
  const { body, loadAll } = useText(path, open, onRead)

  useEffect(() => {
    let live = true
    api.action(InfoAction, { path }).then(
      (file) =>
        live &&
        setInfo(file ? { kind: 'ready', size: file.size, lines: file.lines } : { kind: 'missing' }),
      (error: unknown) => live && setInfo({ kind: 'failed', reason: errorMessage(error) }),
    )
    return () => {
      live = false
    }
  }, [path])

  if (info.kind === 'missing' || info.kind === 'failed')
    return (
      <span className={card} data-ui="media-text" title={path}>
        <span className="flex items-center gap-2.5 px-2.5 py-2">
          <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground/70">
            <FileXIcon className="size-5" strokeWidth={1.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-5 text-muted-foreground">
              {label}
            </span>
            <span
              className={cn(
                'block truncate text-[11px] leading-4 text-muted-foreground/80',
                info.kind === 'failed' && 'text-destructive/80',
              )}
            >
              {label === name ? '' : `${name} · `}
              {info.kind === 'missing' ? 'File no longer exists' : info.reason}
            </span>
          </span>
        </span>
      </span>
    )

  const note = info.kind === 'checking' ? 'Checking…' : meta(info.size, info.lines)
  return (
    <span className={cn(card, open && 'max-w-none')} data-ui="media-text" title={path}>
      <span className="flex items-center gap-1 pr-1.5">
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2.5 text-left"
          onClick={() => setOpen(!open)}
          type="button"
        >
          <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
            {info.kind === 'checking' || (open && body?.kind === 'loading') ? (
              <LoaderCircleIcon className="size-5 motion-safe:animate-spin" />
            ) : (
              <Icon className="size-5" strokeWidth={1.5} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-5 text-foreground/90">{label}</span>
            <span className="block truncate text-[11px] leading-4 text-muted-foreground">
              {label === name ? note : `${name} · ${note}`}
            </span>
          </span>
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
        {open && <Actions body={body} path={path} />}
        <IconButton label="Full screen" onClick={() => setFull(true)}>
          <ExpandIcon className="size-4" />
        </IconButton>
      </span>
      {open && (
        <span className="block max-h-[28rem] overflow-auto border-t border-border/60">
          <Contents body={body} loadAll={loadAll} path={path} />
        </span>
      )}
      <TextDialog onOpenChange={setFull} onRead={onRead} open={full} path={path} />
    </span>
  )
}

/**
 * The full-screen viewer of a text file: the card's Full screen, and a path in inline code. It fills a phone's screen
 * and reads the file each time it opens.
 */
export function TextDialog({
  path,
  open,
  onOpenChange,
  onRead,
}: {
  path: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRead?: (text: Text | undefined) => void
}) {
  const { body, loadAll } = useText(path, open, onRead)
  const home = useSystem()?.machine.home
  const name = path.split('/').at(-1) ?? path
  const shown = body?.kind === 'shown' ? body.text : undefined
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-border/80 bg-terminal p-0 sm:h-[90vh] sm:w-[min(64rem,calc(100vw-4rem))] sm:max-w-none sm:rounded-lg"
        // Focus the viewer, not its first button: a ring on Copy reads as a selection.
        onOpenAutoFocus={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <span className="flex items-center gap-1 border-b border-border/60 py-1.5 pr-1.5 pl-3">
          <span className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[13px] leading-5 font-normal text-foreground/90">
              {name}
            </DialogTitle>
            <span className="block truncate font-mono text-[11px] leading-4 text-muted-foreground">
              {shown && `${meta(shown.size, shown.lines)} · `}
              {elidePath(shortenPath(path, { home }), 60)}
            </span>
          </span>
          <Actions body={body} path={path} />
          <IconButton label="Close" onClick={() => onOpenChange(false)}>
            <XIcon className="size-4" />
          </IconButton>
        </span>
        <div className="min-h-0 flex-1 overflow-auto">
          <Contents body={body} loadAll={loadAll} path={path} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Copy, once the text shows, and Open in Zed on the machine Ultimate runs on. */
function Actions({ body, path }: { body?: Body; path: string }) {
  return (
    <>
      {body?.kind === 'shown' && <CopyButton text={body.text.text} />}
      {onHost && (
        <IconButton label="Open in Zed" onClick={() => edit(path)}>
          <CodeIcon className="size-4" />
        </IconButton>
      )}
    </>
  )
}

const card =
  'my-1 inline-block w-full max-w-md overflow-hidden align-top rounded-md border border-border/80 bg-terminal not-prose'

/** The file's text: Markdown rendered as the transcript renders it, anything else highlighted with line numbers. */
function Contents({ body, path, loadAll }: { body?: Body; path: string; loadAll: () => void }) {
  if (!body || body.kind === 'loading')
    return <span className="block px-3 py-2 text-[12px] text-muted-foreground">Reading…</span>
  if (body.kind === 'failed')
    return <span className="block px-3 py-2 text-[12px] text-destructive/80">{body.reason}</span>
  const { text, truncated, size } = body.text
  return (
    <span className="block">
      {isMarkdown(path) ? (
        <MarkdownFile path={path} text={text} />
      ) : (
        <CodeBlock
          className="rounded-none border-0"
          code={text}
          language={languageFromPath(path)}
          showLineNumbers
        />
      )}
      {truncated && (
        <span className="flex items-center gap-2 border-t border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          Showing {formatBytes(new TextEncoder().encode(text).length)} of {formatBytes(size)}
          {!body.all && (
            <button className="text-brand hover:underline" onClick={loadAll} type="button">
              Load all
            </button>
          )}
        </span>
      )}
    </span>
  )
}

type Mdast = { url?: unknown; children?: Mdast[] }
/**
 * A remark plugin: links and images in a Markdown file in `folder` point at the files beside it. Streamdown caches its
 * processors by plugin name and options, so the folder is an option, never a closure.
 */
function resolveLinks({ folder }: { folder: string }) {
  const walk = (node: Mdast) => {
    if (typeof node.url === 'string') node.url = resolveLink(node.url, folder)
    node.children?.forEach(walk)
  }
  return walk
}

/**
 * A Markdown file rendered as the transcript renders messages, except that relative links resolve against the file's
 * folder: Streamdown's rehype-harden would otherwise turn `../README.md` into `/README.md` and drop `docs/plan.md`, so
 * this resolves them before it runs. `#123` is not a conversation in a file, so the transcript's mention chips stay out.
 */
function MarkdownFile({ path, text }: { path: string; text: string }) {
  const folder = path.slice(0, path.lastIndexOf('/'))
  const remarkPlugins = useMemo(
    (): ComponentProps<typeof MessageResponse>['remarkPlugins'] => [
      ...Object.values(defaultRemarkPlugins),
      [resolveLinks, { folder }],
    ],
    [folder],
  )
  return (
    <span className="mx-auto block max-w-3xl px-3.5 py-2.5">
      <MessageResponse remarkPlugins={remarkPlugins}>{text}</MessageResponse>
    </span>
  )
}

const edit = (path: string) =>
  void api
    .action(EditAction, { path })
    .catch((error: unknown) => store.notify({ level: 'error', message: errorMessage(error) }))

function CopyButton({ text }: { text: string }) {
  const { copied, copy } = useCopy()
  return (
    <IconButton label="Copy" onClick={() => copy(text)}>
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
    </IconButton>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}
