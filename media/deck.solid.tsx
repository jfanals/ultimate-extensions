/** @jsxImportSource @solidjs/web */
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
} from '@lucide/solid'
import type { JSX } from '@solidjs/web'
import { createEffect, createMemo, createSignal, For, onSettled, Show } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { actionRef, cn, errorMessage, keepLast, useAction } from '@/sdk/solid'
import { toggleFullscreen, useCaptions, usePlayerKeys } from './keys.ts'
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

/** What Play started: its loading, the part playing, or why it failed. */
type Started =
  | { kind: 'failed'; reason: string }
  | { kind: 'loading'; done: number; total: number }
  | ({ kind: 'playing' } & Loaded)
type State = { kind: 'checking' } | { kind: 'ready' } | Started

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/** The cue showing at `time`: the last one that has started. */
const cueAt = (deck: Deck, time: number) => {
  let index = 0
  while (index + 1 < deck.cues.length && deck.cues[index + 1].start <= time) index++
  return index
}

/**
 * A link to a narrated deck's deck.json, as a slide player: each slide with its spoken line, the narration track,
 * scene skipping and a scrubber. The first slide shows at once; Play loads the audio and the other slides.
 *
 * A deck still building (`building`) is read again every second and plays what is there: each newer part arrives with
 * a longer audio track, loaded while the current one plays and taken over where it ends.
 */
export function DeckCard(props: { path: string }) {
  /** The deck as deck.json says now; while playing, `state.deck` is the part loaded. */
  const read = useAction(
    DeckAction,
    {
      get path() {
        return props.path
      },
    },
    // A read that fails while the build rewrites the deck is tried again a second later.
    { every: (deck) => (deck?.building ? 1000 : undefined), onError: keepLast },
  )
  const latest = read.data
  const [started, setState] = createSignal<Started>()
  const state = (): State => {
    const error = read.error()
    return (
      started() ??
      (latest()
        ? { kind: 'ready' }
        : error
          ? { kind: 'failed', reason: errorMessage(error) }
          : { kind: 'checking' })
    )
  }
  const [poster, setPoster] = createSignal<string>()
  /** The newest part, loaded and ready to take over when the one playing ends. */
  const [next, setNext] = createSignal<Loaded>()
  /** Playing reached the end of the part loaded while the deck builds on. */
  const [waiting, setWaiting] = createSignal(false)
  const loader = new AbortController()
  // Every Blob URL this card made, released when it goes away.
  const made = new Set<string>()
  const [time, setTime] = createSignal(0)
  const [paused, setPaused] = createSignal(true)
  let audio: HTMLAudioElement | undefined
  /** Where a newer part's audio picks up once it has loaded. */
  let resume: { at: number; play: boolean } | undefined
  let stage: HTMLSpanElement | undefined
  const [captions, setCaptions] = useCaptions()

  const building = () => latest()?.building === true
  const first = createMemo(() => latest()?.cues[0]?.image)
  createEffect(first, (image) => {
    if (!image) return
    load(image, () => {}, loader.signal).then(
      (url) => {
        made.add(url)
        setPoster(url)
      },
      (error: unknown) => {
        // Unmounting aborts the poster load; there is nothing left to show it on.
        if (!loader.signal.aborted) setState({ kind: 'failed', reason: errorMessage(error) })
      },
    )
  })
  onSettled(() => () => {
    loader.abort()
    for (const url of made) URL.revokeObjectURL(url)
  })

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
      audio: audioUrl,
      frames: new Map([...have, ...images.map((image, i) => [image, frames[i]] as const)]),
    }
  }

  /** Which load Play started last: one given up for a retry no longer moves the progress. */
  let attempt = 0
  const start = () => {
    const current = latest()
    if (state().kind !== 'ready' || !current?.cues.length) return
    const begin = (deck: Deck, retry: boolean) => {
      const total = new Set(deck.cues.map((cue) => cue.image)).size + 1
      const mine = ++attempt
      let done = 0
      setState({ kind: 'loading', done, total })
      const tick = () => mine === attempt && setState({ kind: 'loading', done: ++done, total })
      fetchParts(deck, new Map(), tick).then(
        (loaded) => mine === attempt && setState({ kind: 'playing', ...loaded }),
        async (error: unknown) => {
          if (loader.signal.aborted || mine !== attempt) return
          // A build that finishes meanwhile removes the parts it published on the way: load the finished deck.
          if (retry && deck.building) return begin((await read.refetch()) ?? deck, false)
          setState({ kind: 'failed', reason: errorMessage(error) })
        },
      )
    }
    begin(current, true)
  }

  const playing = () => {
    const now = state()
    return now.kind === 'playing' ? now : undefined
  }
  // While a building deck plays, load each newer part as it is published.
  let fetching: string | undefined
  createEffect(
    () => ({ newest: next() ?? playing(), published: latest() }),
    ({ newest, published }) => {
      if (!newest || !published?.cues.length || published.audio === newest.deck.audio) return
      if (fetching === published.audio) return
      fetching = published.audio
      fetchParts(published, newest.frames).then(
        (loaded) =>
          setNext((now) =>
            loaded.deck.duration >
            Math.max(now?.deck.duration ?? 0, playing()?.deck.duration ?? 0)
              ? loaded
              : now,
          ),
        (error: unknown) => {
          if (loader.signal.aborted) return
          // A part the build removed on the way: the next read brings the newer one, loaded instead.
          if (published.building) fetching = undefined
          else setState({ kind: 'failed', reason: errorMessage(error) })
        },
      )
    },
  )
  // Playing that reached the end of its part goes on in the newer one, from where it stopped.
  createEffect(
    () => (waiting() ? next() : undefined),
    (part) => {
      if (!part) return
      resume = { at: audio?.currentTime ?? 0, play: true }
      setState({ kind: 'playing', ...part })
      setNext(undefined)
    },
  )
  /** More is coming after the part playing: the build goes on, or a newer part is out. */
  const more = () => {
    const now = playing()
    const published = latest()
    return !!now && !!published && (building() || published.audio !== now.deck.audio)
  }
  // A build that stops at the part playing ends the wait.
  const held = () => waiting() && more()

  const seek = (to: number) => {
    const now = playing()
    const element = audio
    if (!now || !element) return
    const clamped = Math.max(0, Math.min(now.deck.duration, to))
    // A newer part still loading starts where the seek points, not where the last one ended.
    if (resume) resume.at = clamped
    else element.currentTime = clamped
    setTime(clamped)
    if (held()) {
      setWaiting(false)
      void element.play()
    }
  }

  const toggle = () => {
    if (state().kind === 'ready') return start()
    const element = audio
    if (!playing() || !element) return
    // Waiting for the next part counts as playing: pausing stays at the end, playing there waits again.
    if (resume) {
      // A newer part is loading: pausing now keeps it paused, and no later part plays it on.
      resume.play = !resume.play
      setWaiting(resume.play)
    } else if (held()) setWaiting(false)
    else if (element.ended && more()) setWaiting(true)
    else if (element.paused) void element.play()
    else element.pause()
  }

  const onKey = (key: string) => {
    if (state().kind === 'ready' && (key === ' ' || key === 'k')) return (start(), true)
    const element = audio
    const now = playing()
    if (!now || !element) return false
    const jump = (by: number) => seek(element.currentTime + by)
    if (key === ' ' || key === 'k') toggle()
    else if (key === 'ArrowLeft') jump(-5)
    else if (key === 'ArrowRight') jump(5)
    else if (key === 'j') jump(-10)
    else if (key === 'l') jump(10)
    else if (key === 'f') toggleFullscreen(stage)
    else if (key === 'c' && now.deck.captions) setCaptions(!captions())
    else return false
    return true
  }

  // Follow the audio smoothly; `timeupdate` alone fires only about four times a second.
  createEffect(paused, (still) => {
    if (still) return undefined
    let frame = requestAnimationFrame(function follow() {
      if (audio) setTime(audio.currentTime)
      frame = requestAnimationFrame(follow)
    })
    return () => cancelAnimationFrame(frame)
  })

  const deck = () => playing()?.deck ?? latest()!
  const cue = () => deck().cues[cueAt(deck(), time())]
  const scenes = () => {
    const { cues } = deck()
    return cues.filter((c, i) => i === 0 || cues[i - 1].scene !== c.scene)
  }
  const scene = () => {
    const now = time()
    return scenes().findLastIndex((s) => s.start <= now + 0.01)
  }
  const image = () => {
    const now = playing()
    return now ? now.frames.get(cue().image) : poster()
  }
  const skip = (direction: 1 | -1) => {
    const all = scenes()
    const current = scene()
    // Back within the first two seconds of a scene goes to the previous one, like a music player.
    const target =
      direction === 1
        ? all[current + 1]
        : time() - all[current].start > 2
          ? all[current]
          : all[current - 1]
    if (target) seek(target.start)
  }
  const loading = () => {
    const now = state()
    return now.kind === 'loading' ? now : undefined
  }
  // No slide to show yet: a build that has not voiced its first line, or one that failed before it.
  const empty = () =>
    state().kind === 'checking' || state().kind === 'failed' || !latest()?.cues.length
  const failed = () => state().kind === 'failed' || !!latest()?.error
  const note = () => {
    const now = state()
    return now.kind === 'checking'
      ? 'Checking…'
      : now.kind === 'failed'
        ? now.reason
        : (latest()?.error ?? 'Building…')
  }
  return (
    <Show
      when={!empty()}
      fallback={
        <span
          class="my-1 flex w-full max-w-2xl items-center gap-2.5 rounded-md border border-border/80 bg-terminal px-2.5 py-2 not-prose"
          data-ui="deck-card"
          title={props.path}
        >
          <span class="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
            <Show
              when={failed()}
              fallback={<LoaderCircleIcon class="size-5 motion-safe:animate-spin" />}
            >
              <PresentationIcon class="size-5" stroke-width={1.5} />
            </Show>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] leading-5 text-foreground/90">
              {latest()?.title || props.path.split('/').at(-2)}
            </span>
            <span
              class={cn(
                'block truncate text-[11px] leading-4 text-muted-foreground',
                failed() && 'text-destructive/80',
              )}
            >
              {note()}
            </span>
          </span>
        </span>
      }
    >
      <span
        class="group/deck my-1 block w-full max-w-2xl overflow-hidden rounded-md border border-border/80 bg-terminal align-top not-prose"
        data-ui="deck-card"
        ref={usePlayerKeys(onKey)}
        title={props.path}
      >
        <span
          class="relative block w-full overflow-hidden bg-black"
          ref={stage}
          style={{
            'aspect-ratio': `${deck().width} / ${deck().height}`,
            'container-type': 'inline-size',
          }}
        >
          <Show when={image()}>
            {(src) => <img alt={cue().text} class="block size-full object-contain" src={src()} />}
          </Show>
          <Show when={playing() && deck().captions && captions() && cue().text}>
            {/* The slide leaves its bottom fifth empty, so the caption covers no content. */}
            <span
              class="pointer-events-none absolute inset-x-0 bottom-[5%] flex justify-center px-[8%]"
              data-ui="deck-caption"
            >
              <span
                class="rounded-[0.2em] bg-black/75 px-[0.45em] py-[0.12em] text-center leading-[1.35] font-medium text-white [box-decoration-break:clone]"
                style={{ 'font-size': 'clamp(12px, 2.5cqw, 48px)' }}
              >
                {cue().text}
              </span>
            </span>
          </Show>
          <Show when={held()}>
            {/* The end of what is built so far: the next part takes over as soon as it is loaded. */}
            <span
              class="absolute inset-0 flex items-center justify-center"
              data-ui="deck-waiting"
              title="Building…"
            >
              <span class="flex size-14 items-center justify-center rounded-full bg-foreground/90 text-background shadow-lg">
                <LoaderCircleIcon class="size-6 motion-safe:animate-spin" />
              </span>
            </span>
          </Show>
          <Show when={!playing()}>
            <Button
              aria-label={`Play ${deck().title}`}
              class="absolute inset-0 flex items-center justify-center rounded-none bg-black/10 transition-colors hover:bg-black/20 disabled:opacity-100 data-disabled:opacity-100"
              disabled={!!loading()}
              onClick={start}
              size={null}
              variant={null}
            >
              <span class="flex size-14 items-center justify-center rounded-full bg-foreground/90 text-background shadow-lg">
                <Show
                  when={loading()}
                  fallback={<PlayIcon class="size-6 translate-x-0.5" fill="currentColor" />}
                >
                  <LoaderCircleIcon class="size-6 motion-safe:animate-spin" />
                </Show>
              </span>
            </Button>
          </Show>
        </span>
        <Show when={playing()}>
          {(part) => (
            <audio
              class="hidden"
              onEnded={() => {
                setPaused(true)
                if (more()) setWaiting(true)
              }}
              onLoadedMetadata={(event) => {
                // Play starts at once; a newer part of a building deck picks up where the last one stopped, unless the
                // listener paused meanwhile. play() here also keeps going on a phone without another tap.
                const { at, play } = resume ?? { at: undefined, play: true }
                resume = undefined
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
                if (resume === undefined) setTime(event.currentTarget.currentTime)
              }}
              ref={audio}
              src={part().audio}
            />
          )}
        </Show>
        <span class="flex items-center gap-1 px-1.5 py-1.5">
          <Button
            aria-label={paused() && !held() ? 'Play' : 'Pause'}
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-50"
            disabled={!!loading()}
            onClick={toggle}
            size={null}
            variant={null}
          >
            <Show
              when={paused() && !held()}
              fallback={<PauseIcon class="size-4" fill="currentColor" />}
            >
              <PlayIcon class="size-4 translate-x-px" fill="currentColor" />
            </Show>
          </Button>
          <DeckButton disabled={!playing()} label="Previous slide" onClick={() => skip(-1)}>
            <SkipBackIcon class="size-4" />
          </DeckButton>
          <DeckButton disabled={!playing()} label="Next slide" onClick={() => skip(1)}>
            <SkipForwardIcon class="size-4" />
          </DeckButton>
          <span class="relative mx-1.5 flex h-8 min-w-0 flex-1 items-center">
            <span class="absolute inset-x-0 h-1 rounded-full bg-border/70">
              <span
                class="absolute inset-y-0 left-0 rounded-full bg-brand"
                style={{ width: `${(time() / deck().duration) * 100}%` }}
              />
              <For each={scenes().slice(1)}>
                {(s) => (
                  <span
                    class="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted-foreground/60"
                    style={{ left: `${(s.start / deck().duration) * 100}%` }}
                  />
                )}
              </For>
            </span>
            <input
              aria-label="Position"
              class="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-default"
              disabled={!playing()}
              max={deck().duration}
              min={0}
              onInput={(event) => seek(Number(event.currentTarget.value))}
              step={0.1}
              type="range"
              value={time()}
            />
          </span>
          <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            <Show
              when={loading()}
              fallback={`${clock(time())} / ${clock(deck().duration)}${building() || latest()?.audio !== deck().audio ? '…' : ''}`}
            >
              {(now) => `Loading ${Math.floor((now().done / now().total) * 100)}%`}
            </Show>
          </span>
          <span class="shrink-0 px-1.5 text-[11px] tabular-nums text-muted-foreground">
            {scene() + 1}/{scenes().length}
          </span>
          <Show when={deck().captions}>
            <DeckButton
              disabled={!playing()}
              label={captions() ? 'Hide captions (c)' : 'Show captions (c)'}
              onClick={() => setCaptions(!captions())}
            >
              <Show when={captions()} fallback={<CaptionsOffIcon class="size-4" />}>
                <CaptionsIcon class="size-4" />
              </Show>
            </DeckButton>
          </Show>
          <DeckButton
            disabled={!image()}
            label="Full screen (f)"
            onClick={() => toggleFullscreen(stage)}
          >
            <ExpandIcon class="size-4" />
          </DeckButton>
        </span>
        <Show when={latest()?.error}>
          {(error) => (
            <span class="block px-2.5 pb-2 text-[11px] leading-4 text-destructive/80">
              Build stopped: {error()}
            </span>
          )}
        </Show>
      </span>
    </Show>
  )
}

function DeckButton(props: {
  label: string
  disabled: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <Button
      aria-label={props.label}
      class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      disabled={props.disabled}
      onClick={() => props.onClick()}
      size={null}
      title={props.label}
      variant={null}
    >
      {props.children}
    </Button>
  )
}
