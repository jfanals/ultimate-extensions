import {
  ExpandIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  PresentationIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { actionRef, api, cn, errorMessage } from '@/sdk'
import { load } from './load.ts'

/** A narrated deck's manifest with absolute paths (server.ts `deck`, media.ts `Deck`). */
type Deck = {
  title: string
  width: number
  height: number
  duration: number
  audio: string
  cues: { scene: number; text: string; image: string; start: number }[]
}
const DeckAction = actionRef<{ path: string }, Deck>('media', 'deck')

type State =
  | { kind: 'checking' }
  | { kind: 'failed'; reason: string }
  | { kind: 'ready'; deck: Deck; poster?: string }
  | { kind: 'loading'; deck: Deck; poster?: string; done: number; total: number }
  | { kind: 'playing'; deck: Deck; audio: string; frames: Map<string, string> }

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/** The cue showing at `time`: the last one that has started. */
const cueAt = (deck: Deck, time: number) => {
  let index = 0
  while (index + 1 < deck.cues.length && deck.cues[index + 1]!.start <= time) index++
  return index
}

/**
 * A link to a narrated deck's deck.json, as a slide player: each slide with its spoken line, the narration track,
 * scene skipping and a scrubber. The first slide shows at once; Play loads the audio and the other slides.
 */
export function DeckCard({ path }: { path: string }) {
  const [state, setState] = useState<State>({ kind: 'checking' })
  const [loader] = useState(() => new AbortController())
  // Every Blob URL this card made, released when it goes away.
  const [made] = useState(() => new Set<string>())
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(true)
  const audio = useRef<HTMLAudioElement>(null)
  const stage = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let live = true
    api
      .action(DeckAction, { path })
      .then(async (deck) => {
        if (!live) return
        setState({ kind: 'ready', deck })
        const poster = await load(deck.cues[0]!.image, () => {}, loader.signal)
        made.add(poster)
        if (live) setState((now) => (now.kind === 'ready' ? { ...now, poster } : now))
      })
      .catch((error: unknown) => {
        // Unmounting aborts the poster load; there is nothing left to show it on.
        if (live && !loader.signal.aborted)
          setState({ kind: 'failed', reason: errorMessage(error) })
      })
    return () => {
      live = false
    }
  }, [path, loader, made])
  useEffect(
    () => () => {
      loader.abort()
      for (const url of made) URL.revokeObjectURL(url)
    },
    [loader, made],
  )

  const start = () => {
    if (state.kind !== 'ready') return
    const { deck, poster } = state
    const images = [...new Set(deck.cues.map((cue) => cue.image))]
    const total = images.length + 1
    let done = 0
    const tick = (url: string) => (
      made.add(url),
      setState({ kind: 'loading', deck, poster, done: ++done, total })
    )
    setState({ kind: 'loading', deck, poster, done, total })
    Promise.all([
      load(deck.audio, () => {}, loader.signal).then((url) => (tick(url), url)),
      ...images.map((image) =>
        load(image, () => {}, loader.signal).then((url) => (tick(url), [image, url] as const)),
      ),
    ]).then(
      ([audioUrl, ...frames]) => {
        setState({
          kind: 'playing',
          deck,
          audio: audioUrl as string,
          frames: new Map(frames as (readonly [string, string])[]),
        })
      },
      (error: unknown) => {
        if (!loader.signal.aborted) setState({ kind: 'failed', reason: errorMessage(error) })
      },
    )
  }

  // Follow the audio smoothly; `timeupdate` alone fires only about four times a second.
  useEffect(() => {
    if (paused) return
    let frame = requestAnimationFrame(function follow() {
      if (audio.current) setTime(audio.current.currentTime)
      frame = requestAnimationFrame(follow)
    })
    return () => cancelAnimationFrame(frame)
  }, [paused])

  if (state.kind === 'checking' || state.kind === 'failed')
    return (
      <span
        className="my-1 flex w-full max-w-2xl items-center gap-2.5 rounded-md border border-border/80 bg-terminal px-2.5 py-2 not-prose"
        data-ui="deck-card"
        title={path}
      >
        <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
          {state.kind === 'checking' ? (
            <LoaderCircleIcon className="size-5 motion-safe:animate-spin" />
          ) : (
            <PresentationIcon className="size-5" strokeWidth={1.5} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-5 text-foreground/90">
            {path.split('/').at(-2)}
          </span>
          <span
            className={cn(
              'block truncate text-[11px] leading-4 text-muted-foreground',
              state.kind === 'failed' && 'text-destructive/80',
            )}
          >
            {state.kind === 'checking' ? 'Checking…' : state.reason}
          </span>
        </span>
      </span>
    )

  const { deck } = state
  const playing = state.kind === 'playing'
  const index = cueAt(deck, time)
  const cue = deck.cues[index]!
  const scenes = deck.cues.filter((c, i) => i === 0 || deck.cues[i - 1]!.scene !== c.scene)
  const image = playing ? state.frames.get(cue.image) : state.poster
  const seek = (to: number) => {
    const clamped = Math.max(0, Math.min(deck.duration, to))
    if (audio.current) audio.current.currentTime = clamped
    setTime(clamped)
  }
  const skip = (direction: 1 | -1) => {
    const current = scenes.findLastIndex((s) => s.start <= time + 0.01)
    // Back within the first two seconds of a scene goes to the previous one, like a music player.
    const target =
      direction === 1
        ? scenes[current + 1]
        : time - scenes[current]!.start > 2
          ? scenes[current]
          : scenes[current - 1]
    if (target) seek(target.start)
  }
  const toggle = () => {
    if (!playing) return start()
    const element = audio.current
    if (!element) return
    if (element.paused) void element.play()
    else element.pause()
  }

  return (
    <span
      className="group/deck my-1 block w-full max-w-2xl overflow-hidden rounded-md border border-border/80 bg-terminal align-top not-prose"
      data-ui="deck-card"
      title={path}
    >
      <span
        className="relative block w-full overflow-hidden bg-black"
        ref={stage}
        style={{ aspectRatio: `${deck.width} / ${deck.height}` }}
      >
        {image && <img alt={cue.text} className="block size-full object-contain" src={image} />}
        {!playing && (
          <button
            aria-label={`Play ${deck.title}`}
            className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/20"
            disabled={state.kind === 'loading'}
            onClick={start}
            type="button"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-foreground/90 text-background shadow-lg">
              {state.kind === 'loading' ? (
                <LoaderCircleIcon className="size-6 motion-safe:animate-spin" />
              ) : (
                <PlayIcon className="size-6 translate-x-0.5" fill="currentColor" />
              )}
            </span>
          </button>
        )}
      </span>
      {playing && (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- every slide shows its spoken line as a subtitle.
        <audio
          autoPlay
          className="hidden"
          onEnded={() => setPaused(true)}
          onPause={() => setPaused(true)}
          onPlay={() => setPaused(false)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          ref={audio}
          src={state.audio}
        />
      )}
      <span className="flex items-center gap-1 px-1.5 py-1.5">
        <button
          aria-label={paused ? 'Play' : 'Pause'}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          disabled={state.kind === 'loading'}
          onClick={toggle}
          type="button"
        >
          {paused ? (
            <PlayIcon className="size-4 translate-x-px" fill="currentColor" />
          ) : (
            <PauseIcon className="size-4" fill="currentColor" />
          )}
        </button>
        <DeckButton disabled={!playing} label="Previous slide" onClick={() => skip(-1)}>
          <SkipBackIcon className="size-4" />
        </DeckButton>
        <DeckButton disabled={!playing} label="Next slide" onClick={() => skip(1)}>
          <SkipForwardIcon className="size-4" />
        </DeckButton>
        <span className="relative mx-1.5 flex h-8 min-w-0 flex-1 items-center">
          <span className="absolute inset-x-0 h-1 rounded-full bg-border/70">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-brand"
              style={{ width: `${(time / deck.duration) * 100}%` }}
            />
            {scenes.slice(1).map((s) => (
              <span
                className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted-foreground/60"
                key={s.start}
                style={{ left: `${(s.start / deck.duration) * 100}%` }}
              />
            ))}
          </span>
          <input
            aria-label="Position"
            className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-default"
            disabled={!playing}
            max={deck.duration}
            min={0}
            onChange={(event) => seek(Number(event.target.value))}
            step={0.1}
            type="range"
            value={time}
          />
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {state.kind === 'loading'
            ? `Loading ${Math.floor((state.done / state.total) * 100)}%`
            : `${clock(time)} / ${clock(deck.duration)}`}
        </span>
        <span className="shrink-0 px-1.5 text-[11px] tabular-nums text-muted-foreground">
          {scenes.findLastIndex((s) => s.start <= time + 0.01) + 1}/{scenes.length}
        </span>
        <DeckButton
          disabled={!image}
          label="Full screen"
          onClick={() => void stage.current?.requestFullscreen()}
        >
          <ExpandIcon className="size-4" />
        </DeckButton>
      </span>
    </span>
  )
}

function DeckButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}
