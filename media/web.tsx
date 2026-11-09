import { FileAudioIcon, FileVideoIcon, LoaderCircleIcon, PlayIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { actionRef, api, cn, defineWebExtension, errorMessage, formatBytes } from '@/sdk'
import { PathCode } from './code.tsx'
import { DeckCard } from './deck.tsx'
import { toggleFullscreen, useCaptions, usePlayerKeys } from './keys.ts'
import { InfoAction, load, MAX_BYTES } from './load.ts'
import { TextCard } from './text.tsx'
import { isDeck, isPathCandidate, isText, mediaType } from './types.ts'

/** `{ path }` → the WebVTT subtitles beside a video (its `.vtt` or `.srt`), or null (server.ts). */
const CaptionsAction = actionRef<{ path: string }, string | null>('media', 'captions')

type State =
  | { kind: 'checking' }
  | { kind: 'ready'; size: number }
  | { kind: 'loading'; size: number; read: number }
  | { kind: 'playing'; size: number; url: string; captions?: string }
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
  const track = state.kind === 'playing' ? state.captions : undefined
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
      if (track) URL.revokeObjectURL(track)
    },
    [url, track],
  )
  const player = useRef<HTMLMediaElement>(null)
  const [captions, setCaptions] = useCaptions()
  // The video's own caption menu and the C key both turn its subtitles on and off.
  useEffect(() => {
    if (!track) return
    // Safari also lists an MP4's own subtitle track: one track shows at most, so captions never double.
    const tracks = [...(player.current?.textTracks ?? [])]
    tracks.forEach((t, i) => (t.mode = captions && i === 0 ? 'showing' : 'disabled'))
  }, [captions, track])

  const play = () => {
    if (state.kind !== 'ready') return
    const { size } = state
    setState({ kind: 'loading', size, read: 0 })
    Promise.all([
      load(path, (read) => setState({ kind: 'loading', size, read }), loader.signal),
      video ? api.action(CaptionsAction, { path }, { signal: loader.signal }) : null,
    ]).then(
      ([blob, vtt]) =>
        setState({
          kind: 'playing',
          size,
          url: blob,
          captions: vtt ? URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })) : undefined,
        }),
      (error: unknown) => {
        // Unmounting aborts the load; there is nothing left to show it on.
        if (!loader.signal.aborted) setState({ kind: 'failed', reason: errorMessage(error) })
      },
    )
  }

  const keys = usePlayerKeys((key) => {
    if (state.kind === 'ready' && (key === ' ' || key === 'k')) return (play(), true)
    const element = player.current
    if (!element) return false
    const jump = (by: number) =>
      (element.currentTime = Math.max(0, Math.min(element.duration || 0, element.currentTime + by)))
    if (key === ' ' || key === 'k') {
      if (element.paused) void element.play()
      else element.pause()
    } else if (key === 'ArrowLeft') jump(-5)
    else if (key === 'ArrowRight') jump(5)
    else if (key === 'j') jump(-10)
    else if (key === 'l') jump(10)
    else if (key === 'f' && video) toggleFullscreen(element)
    else if (key === 'c' && track) setCaptions(!captions)
    else return false
    return true
  })

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
      ref={keys}
      title={path}
    >
      {state.kind === 'playing' && video && (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- a recording has captions only when a .vtt or .srt sits beside it.
        <video
          autoPlay
          className="block aspect-video w-full bg-black"
          controls
          playsInline
          ref={player as RefObject<HTMLVideoElement>}
          src={state.url}
        >
          {state.captions && (
            <track default={captions} kind="subtitles" label="Captions" src={state.captions} />
          )}
        </video>
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
        <audio
          autoPlay
          className="block h-10 w-full px-1.5 pb-1.5"
          controls
          ref={player as RefObject<HTMLAudioElement>}
          src={state.url}
        />
      )}
    </span>
  )
}

export default defineWebExtension({
  inlineCode: ({ code, core }) =>
    isPathCandidate(code) ? <PathCode code={code} core={core} /> : core,
  link: ({ href, children, core }) => {
    const type = mediaType(href)
    const deck = isDeck(href)
    const text = isText(href)
    if (!type && !deck && !text) return core
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
    if (deck) return <DeckCard path={path} />
    if (text) return <TextCard label={label} path={path} />
    return <MediaCard label={label} path={path} type={type!} />
  },
})
