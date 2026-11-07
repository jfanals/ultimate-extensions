import { FileAudioIcon, FileVideoIcon, LoaderCircleIcon, PlayIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, cn, defineWebExtension, errorMessage, formatBytes } from '@/sdk'
import { DeckCard } from './deck.tsx'
import { InfoAction, load, MAX_BYTES } from './load.ts'
import { isDeck, mediaType } from './types.ts'

type State =
  | { kind: 'checking' }
  | { kind: 'ready'; size: number }
  | { kind: 'loading'; size: number; read: number }
  | { kind: 'playing'; size: number; url: string }
  | { kind: 'failed'; reason: string }

/** A link to an audio or video file on this machine, as a card that plays it in place. */
function MediaCard({ path, type, label }: { path: string; type: string; label: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'checking' })
  const [loader] = useState(() => new AbortController())
  const video = type.startsWith('video/')
  const name = path.split('/').at(-1) ?? path
  useEffect(() => {
    let live = true
    api
      .action(InfoAction, { path })
      .then(
        ({ size }) =>
          live &&
          setState(
            size > MAX_BYTES
              ? { kind: 'failed', reason: `${formatBytes(size)} · too large to play here` }
              : { kind: 'ready', size },
          ),
      )
      .catch((error: unknown) => live && setState({ kind: 'failed', reason: errorMessage(error) }))
    return () => {
      live = false
    }
  }, [path])
  useEffect(() => () => loader.abort(), [loader])
  const url = state.kind === 'playing' ? state.url : undefined
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )

  const play = () => {
    if (state.kind !== 'ready') return
    const { size } = state
    setState({ kind: 'loading', size, read: 0 })
    load(path, (read) => setState({ kind: 'loading', size, read }), loader.signal).then(
      (url) => setState({ kind: 'playing', size, url }),
      (error: unknown) => {
        // Unmounting aborts the load; there is nothing left to show it on.
        if (!loader.signal.aborted) setState({ kind: 'failed', reason: errorMessage(error) })
      },
    )
  }

  const Icon = video ? FileVideoIcon : FileAudioIcon
  const note =
    state.kind === 'checking'
      ? 'Checking…'
      : state.kind === 'failed'
        ? state.reason
        : state.kind === 'loading'
          ? `Loading ${Math.floor((state.read / state.size) * 100)}% · ${formatBytes(state.size)}`
          : formatBytes(state.size)
  return (
    <span
      className="my-1 inline-block w-full max-w-md overflow-hidden align-top rounded-md border border-border/80 bg-terminal not-prose"
      data-ui="media-card"
      title={path}
    >
      {state.kind === 'playing' && video && (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- the user's own recordings carry no captions.
        <video
          autoPlay
          className="block aspect-video w-full bg-black"
          controls
          playsInline
          src={state.url}
        />
      )}
      <span className="flex items-center gap-2.5 px-2.5 py-2">
        {state.kind === 'ready' ? (
          <button
            aria-label={`Play ${name}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85"
            onClick={play}
            type="button"
          >
            <PlayIcon className="size-4 translate-x-px" fill="currentColor" />
          </button>
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
            {state.kind === 'loading' || state.kind === 'checking' ? (
              <LoaderCircleIcon className="size-5 motion-safe:animate-spin" />
            ) : (
              <Icon className="size-5" strokeWidth={1.5} />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-5 text-foreground/90">{label}</span>
          <span
            className={cn(
              'block truncate text-[11px] leading-4 text-muted-foreground',
              state.kind === 'failed' && 'text-destructive/80',
            )}
          >
            {label === name ? note : `${name} · ${note}`}
          </span>
        </span>
      </span>
      {state.kind === 'loading' && (
        <span className="block h-0.5 bg-border/60">
          <span
            className="block h-full bg-brand transition-[width]"
            style={{ width: `${(state.read / state.size) * 100}%` }}
          />
        </span>
      )}
      {state.kind === 'playing' && !video && (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- the user's own recordings carry no captions.
        <audio autoPlay className="block h-10 w-full px-1.5 pb-1.5" controls src={state.url} />
      )}
    </span>
  )
}

export default defineWebExtension({
  link: ({ href, children, core }) => {
    const type = mediaType(href)
    const deck = isDeck(href)
    if (!type && !deck) return core
    let path: string
    try {
      path = decodeURI(href)
    } catch {
      // A malformed escape is not a path the server could find; leave the link as written.
      return core
    }
    const label =
      typeof children === 'string' && children && children !== href
        ? children
        : path.split('/').at(-1)
    return deck ? <DeckCard path={path} /> : <MediaCard label={label} path={path} type={type!} />
  },
})
