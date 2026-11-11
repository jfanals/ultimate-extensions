import {
  CaptionsIcon,
  CaptionsOffIcon,
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
import { useCaptions, toggleFullscreen, usePlayerKeys } from './keys.ts'
import { load } from './load.ts'

/** A narrated deck's manifest with absolute paths (server.ts `deck`, media.ts `Deck`). */
type Deck = {
  title: string
  width: number
  height: number
  duration: number
  audio: string
  /** Whether the player draws the captions; older decks burned each line into its slide. */
  captions: boolean
  /** The cues so far: none yet while a build starts, or when it failed before the first. */
  cues: { scene: number; text: string; image: string; start: number }[]
  /** Whether deck.py is still adding cues; each new part comes with a longer audio track. */
  building: boolean
  /** Why the build stopped before the deck was finished. */
  error?: string
}
const DeckAction = actionRef<{ path: string }, Deck>('media', 'deck')

/** A deck's audio and slides as Blob URLs. */
type Loaded = { deck: Deck; audio: string; frames: Map<string, string> }

type State =
  | { kind: 'checking' }
  | { kind: 'failed'; reason: string }
  | { kind: 'ready' }
  | { kind: 'loading'; done: number; total: number }
  | ({ kind: 'playing' } & Loaded)

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
 *
 * A deck still building (`building`) is read again every second and plays what is there: each newer part arrives with
 * a longer audio track, loaded while the current one plays and taken over where it ends.
 */
export function DeckCard({ path }: { path: string }) {
  const [state, setState] = useState<State>({ kind: 'checking' })
  /** The deck as deck.json says now; while playing, `state.deck` is the part loaded. */
  const [latest, setLatest] = useState<Deck>()
  const [poster, setPoster] = useState<string>()
  /** The newest part, loaded and ready to take over when the one playing ends. */
  const [next, setNext] = useState<Loaded>()
  /** Playing reached the end of the part loaded while the deck builds on. */
  const [waiting, setWaiting] = useState(false)
  const [loader] = useState(() => new AbortController())
  // Every Blob URL this card made, released when it goes away.
  const [made] = useState(() => new Set<string>())
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(true)
  const audio = useRef<HTMLAudioElement>(null)
  /** Where a newer part's audio picks up once it has loaded. */
  const resume = useRef<{ at: number; play: boolean }>(undefined)
  const stage = useRef<HTMLSpanElement>(null)
  const [captions, setCaptions] = useCaptions()

  useEffect(() => {
    let live = true
    api.action(DeckAction, { path }).then(
      (deck) => {
        if (!live) return
        setLatest(deck)
        setState({ kind: 'ready' })
      },
      (error: unknown) => live && setState({ kind: 'failed', reason: errorMessage(error) }),
    )
    return () => {
      live = false
    }
  }, [path])
  const building = latest?.building === true
  useEffect(() => {
    if (!building) return
    let live = true
    void (async () => {
      while (live) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        // A read that fails while the build rewrites the deck is tried again a second later.
        const deck = await api.action(DeckAction, { path }).catch(() => undefined)
        if (!live || !deck) continue
        setLatest((now) => (JSON.stringify(now) === JSON.stringify(deck) ? now : deck))
      }
    })()
    return () => {
      live = false
    }
  }, [path, building])
  const first = latest?.cues[0]?.image
  useEffect(() => {
    if (!first) return
    load(first, () => {}, loader.signal).then(
      (url) => (made.add(url), setPoster(url)),
      (error: unknown) => {
        // Unmounting aborts the poster load; there is nothing left to show it on.
        if (!loader.signal.aborted) setState({ kind: 'failed', reason: errorMessage(error) })
      },
    )
  }, [first, loader, made])
  useEffect(
    () => () => {
      loader.abort()
      for (const url of made) URL.revokeObjectURL(url)
    },
    [loader, made],
  )

  /** `deck`'s audio and the slides `have` lacks, as Blob URLs; `tick` after each file. */
  const fetchParts = async (deck: Deck, have: Map<string, string>, tick = () => {}) => {
    const images = [...new Set(deck.cues.map((cue) => cue.image))].filter((i) => !have.has(i))
    const keep = (url: string) => (made.add(url), tick(), url)
    const [audioUrl, ...frames] = await Promise.all([
      load(deck.audio, () => {}, loader.signal).then(keep),
      ...images.map((image) => load(image, () => {}, loader.signal).then(keep)),
    ])
    return {
      deck,
      audio: audioUrl!,
      frames: new Map([...have, ...images.map((image, i) => [image, frames[i]!] as const)]),
    }
  }

  /** Which load Play started last: one given up for a retry no longer moves the progress. */
  const attempt = useRef(0)
  const start = () => {
    if (state.kind !== 'ready' || !latest?.cues.length) return
    const begin = (deck: Deck, retry: boolean) => {
      const total = new Set(deck.cues.map((cue) => cue.image)).size + 1
      const mine = ++attempt.current
      let done = 0
      setState({ kind: 'loading', done, total })
      const tick = () =>
        mine === attempt.current && setState({ kind: 'loading', done: ++done, total })
      fetchParts(deck, new Map(), tick).then(
        (loaded) => mine === attempt.current && setState({ kind: 'playing', ...loaded }),
        async (error: unknown) => {
          if (loader.signal.aborted || mine !== attempt.current) return
          // A build that finishes meanwhile removes the parts it published on the way: load the finished deck.
          if (retry && deck.building) {
            const fresh = await api.action(DeckAction, { path }).catch(() => deck)
            setLatest(fresh)
            return begin(fresh, false)
          }
          setState({ kind: 'failed', reason: errorMessage(error) })
        },
      )
    }
    begin(latest, true)
  }

  // While a building deck plays, load each newer part as it is published.
  const newest = next ?? (state.kind === 'playing' ? state : undefined)
  const fetching = useRef<string>(undefined)
  /** How long the part playing is, for a slow load of an older part that finishes after a newer one took over. */
  const playingLength = useRef(0)
  playingLength.current = state.kind === 'playing' ? state.deck.duration : 0
  useEffect(() => {
    if (!newest || !latest?.cues.length || latest.audio === newest.deck.audio) return
    if (fetching.current === latest.audio) return
    fetching.current = latest.audio
    fetchParts(latest, newest.frames).then(
      (loaded) =>
        setNext((now) =>
          loaded.deck.duration > Math.max(now?.deck.duration ?? 0, playingLength.current)
            ? loaded
            : now,
        ),
      (error: unknown) => {
        if (loader.signal.aborted) return
        // A part the build removed on the way: the next read brings the newer one, loaded instead.
        if (latest.building) fetching.current = undefined
        else setState({ kind: 'failed', reason: errorMessage(error) })
      },
    )
  })
  // Playing that reached the end of its part goes on in the newer one, from where it stopped.
  useEffect(() => {
    if (!waiting || !next) return
    resume.current = { at: audio.current?.currentTime ?? 0, play: true }
    setState({ kind: 'playing', ...next })
    setNext(undefined)
  }, [waiting, next])
  /** More is coming after the part playing: the build goes on, or a newer part is out. */
  const more =
    state.kind === 'playing' && !!latest && (building || latest.audio !== state.deck.audio)
  // A build that stops at the part playing ends the wait.
  const held = waiting && more

  const seek = (to: number) => {
    const element = audio.current
    if (state.kind !== 'playing' || !element) return
    const clamped = Math.max(0, Math.min(state.deck.duration, to))
    // A newer part still loading starts where the seek points, not where the last one ended.
    if (resume.current) resume.current.at = clamped
    else element.currentTime = clamped
    setTime(clamped)
    if (held) {
      setWaiting(false)
      void element.play()
    }
  }

  const toggle = () => {
    if (state.kind === 'ready') return start()
    const element = audio.current
    if (state.kind !== 'playing' || !element) return
    // Waiting for the next part counts as playing: pausing stays at the end, playing there waits again.
    if (resume.current) resume.current.play = !resume.current.play
    else if (held) setWaiting(false)
    else if (element.ended && more) setWaiting(true)
    else if (element.paused) void element.play()
    else element.pause()
  }

  const keys = usePlayerKeys((key) => {
    if (state.kind === 'ready' && (key === ' ' || key === 'k')) return (start(), true)
    const element = audio.current
    if (state.kind !== 'playing' || !element) return false
    const jump = (by: number) => seek(element.currentTime + by)
    if (key === ' ' || key === 'k') toggle()
    else if (key === 'ArrowLeft') jump(-5)
    else if (key === 'ArrowRight') jump(5)
    else if (key === 'j') jump(-10)
    else if (key === 'l') jump(10)
    else if (key === 'f') toggleFullscreen(stage.current)
    else if (key === 'c' && state.deck.captions) setCaptions(!captions)
    else return false
    return true
  })

  // Follow the audio smoothly; `timeupdate` alone fires only about four times a second.
  useEffect(() => {
    if (paused) return
    let frame = requestAnimationFrame(function follow() {
      if (audio.current) setTime(audio.current.currentTime)
      frame = requestAnimationFrame(follow)
    })
    return () => cancelAnimationFrame(frame)
  }, [paused])

  // No slide to show yet: a build that has not voiced its first line, or one that failed before it.
  if (state.kind === 'checking' || state.kind === 'failed' || !latest?.cues.length) {
    const note =
      state.kind === 'checking'
        ? 'Checking…'
        : state.kind === 'failed'
          ? state.reason
          : (latest?.error ?? 'Building…')
    const failed = state.kind === 'failed' || !!latest?.error
    return (
      <span
        className="my-1 flex w-full max-w-2xl items-center gap-2.5 rounded-md border border-border/80 bg-terminal px-2.5 py-2 not-prose"
        data-ui="deck-card"
        title={path}
      >
        <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
          {failed ? (
            <PresentationIcon className="size-5" strokeWidth={1.5} />
          ) : (
            <LoaderCircleIcon className="size-5 motion-safe:animate-spin" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-5 text-foreground/90">
            {latest?.title || path.split('/').at(-2)}
          </span>
          <span
            className={cn(
              'block truncate text-[11px] leading-4 text-muted-foreground',
              failed && 'text-destructive/80',
            )}
          >
            {note}
          </span>
        </span>
      </span>
    )
  }

  const playing = state.kind === 'playing'
  const deck = playing ? state.deck : latest
  const index = cueAt(deck, time)
  const cue = deck.cues[index]!
  const scenes = deck.cues.filter((c, i) => i === 0 || deck.cues[i - 1]!.scene !== c.scene)
  const image = playing ? state.frames.get(cue.image) : poster
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
  return (
    <span
      className="group/deck my-1 block w-full max-w-2xl overflow-hidden rounded-md border border-border/80 bg-terminal align-top not-prose"
      data-ui="deck-card"
      ref={keys}
      title={path}
    >
      <span
        className="relative block w-full overflow-hidden bg-black"
        ref={stage}
        style={{ aspectRatio: `${deck.width} / ${deck.height}`, containerType: 'inline-size' }}
      >
        {image && <img alt={cue.text} className="block size-full object-contain" src={image} />}
        {playing && deck.captions && captions && cue.text && (
          // The slide leaves its bottom fifth empty, so the caption covers no content.
          <span
            className="pointer-events-none absolute inset-x-0 bottom-[5%] flex justify-center px-[8%]"
            data-ui="deck-caption"
          >
            <span
              className="rounded-[0.2em] bg-black/75 px-[0.45em] py-[0.12em] text-center leading-[1.35] font-medium text-white [box-decoration-break:clone]"
              style={{ fontSize: 'clamp(12px, 2.5cqw, 48px)' }}
            >
              {cue.text}
            </span>
          </span>
        )}
        {held && (
          // The end of what is built so far: the next part takes over as soon as it is loaded.
          <span
            className="absolute inset-0 flex items-center justify-center"
            data-ui="deck-waiting"
            title="Building…"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-foreground/90 text-background shadow-lg">
              <LoaderCircleIcon className="size-6 motion-safe:animate-spin" />
            </span>
          </span>
        )}
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
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- the stage shows each spoken line as a caption.
        <audio
          className="hidden"
          onEnded={() => {
            setPaused(true)
            if (more) setWaiting(true)
          }}
          onLoadedMetadata={(event) => {
            // Play starts at once; a newer part of a building deck picks up where the last one stopped, unless the
            // listener paused meanwhile. play() here also keeps going on a phone without another tap.
            const { at, play } = resume.current ?? { at: undefined, play: true }
            resume.current = undefined
            if (at !== undefined) event.currentTarget.currentTime = at
            if (!play) return
            void event.currentTarget.play()
          }}
          onPause={() => setPaused(true)}
          onPlay={() => {
            setPaused(false)
            setWaiting(false)
          }}
          onTimeUpdate={(event) => {
            // A new part reports 0 before it moves to where the last one stopped.
            if (resume.current === undefined) setTime(event.currentTarget.currentTime)
          }}
          ref={audio}
          src={state.audio}
        />
      )}
      <span className="flex items-center gap-1 px-1.5 py-1.5">
        <button
          aria-label={paused && !held ? 'Play' : 'Pause'}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          disabled={state.kind === 'loading'}
          onClick={toggle}
          type="button"
        >
          {paused && !held ? (
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
            : `${clock(time)} / ${clock(deck.duration)}${building || latest.audio !== deck.audio ? '…' : ''}`}
        </span>
        <span className="shrink-0 px-1.5 text-[11px] tabular-nums text-muted-foreground">
          {scenes.findLastIndex((s) => s.start <= time + 0.01) + 1}/{scenes.length}
        </span>
        {deck.captions && (
          <DeckButton
            disabled={!playing}
            label={captions ? 'Hide captions (c)' : 'Show captions (c)'}
            onClick={() => setCaptions(!captions)}
          >
            {captions ? (
              <CaptionsIcon className="size-4" />
            ) : (
              <CaptionsOffIcon className="size-4" />
            )}
          </DeckButton>
        )}
        <DeckButton
          disabled={!image}
          label="Full screen (f)"
          onClick={() => toggleFullscreen(stage.current)}
        >
          <ExpandIcon className="size-4" />
        </DeckButton>
      </span>
      {latest.error && (
        <span className="block px-2.5 pb-2 text-[11px] leading-4 text-destructive/80">
          Build stopped: {latest.error}
        </span>
      )}
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
