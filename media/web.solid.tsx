/** @jsxImportSource @solidjs/web */
import { FileAudioIcon, FileVideoIcon, LoaderCircleIcon, PlayIcon } from '@lucide/solid'
import type { JSX } from '@solidjs/web'
import { children, createEffect, createMemo, createSignal, Match, onSettled, Show, Switch } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { actionRef, api, cn, defineWebExtension, errorMessage, formatBytes } from '@/sdk/solid'
import type { InlineCodeRenderer, LinkRenderer } from '@/sdk/solid'
import { PathCode } from './code.solid.tsx'
import { DeckCard } from './deck.solid.tsx'
import { toggleFullscreen, useCaptions, usePlayerKeys } from './keys.ts'
import { InfoAction, load, MAX_BYTES } from './load.ts'
import { TextCard } from './text.solid.tsx'
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
function MediaCard(props: { path: string; type: string; label: string }) {
  const [state, setState] = createSignal<State>({ kind: 'checking' })
  const loader = new AbortController()
  // Every Blob URL this card made, released when it goes away.
  const made = new Set<string>()
  const video = () => props.type.startsWith('video/')
  const name = () => props.path.split('/').at(-1) ?? props.path
  createEffect(
    () => props.path,
    (path) => {
      let live = true
      api
        .action(InfoAction, { path })
        .then(
          (info) =>
            live &&
            setState(
              !info
                ? { kind: 'failed', reason: 'File no longer exists' }
                : info.size > MAX_BYTES
                  ? { kind: 'failed', reason: `${formatBytes(info.size)} · too large to play here` }
                  : { kind: 'ready', size: info.size },
            ),
        )
        .catch((error: unknown) => live && setState({ kind: 'failed', reason: errorMessage(error) }))
      return () => {
        live = false
      }
    },
  )
  onSettled(() => () => {
    loader.abort()
    for (const url of made) URL.revokeObjectURL(url)
  })
  const playing = () => {
    const now = state()
    return now.kind === 'playing' ? now : undefined
  }
  let player: HTMLMediaElement | undefined
  const [captions, setCaptions] = useCaptions()
  // The video's own caption menu and the C key both turn its subtitles on and off.
  createEffect(
    () => ({ on: captions(), track: playing()?.captions }),
    ({ on, track }) => {
      if (!track) return
      // Safari also lists an MP4's own subtitle track: one track shows at most, so captions never double.
      const tracks = [...(player?.textTracks ?? [])]
      tracks.forEach((t, i) => (t.mode = on && i === 0 ? 'showing' : 'disabled'))
    },
  )

  const play = () => {
    const now = state()
    if (now.kind !== 'ready') return
    const { size } = now
    const path = props.path
    setState({ kind: 'loading', size, read: 0 })
    Promise.all([
      load(path, (read) => setState({ kind: 'loading', size, read }), loader.signal),
      video() ? api.action(CaptionsAction, { path }, { signal: loader.signal }) : null,
    ]).then(
      ([blob, vtt]) => {
        const track = vtt ? URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })) : undefined
        made.add(blob)
        if (track) made.add(track)
        setState({ kind: 'playing', size, url: blob, captions: track })
      },
      (error: unknown) => {
        // Unmounting aborts the load; there is nothing left to show it on.
        if (!loader.signal.aborted) setState({ kind: 'failed', reason: errorMessage(error) })
      },
    )
  }

  const keys = usePlayerKeys((key) => {
    if (state().kind === 'ready' && (key === ' ' || key === 'k')) return (play(), true)
    const element = player
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
    else if (key === 'f' && video()) toggleFullscreen(element)
    else if (key === 'c' && playing()?.captions) setCaptions(!captions())
    else return false
    return true
  })

  const note = () => {
    const now = state()
    return now.kind === 'checking'
      ? 'Checking…'
      : now.kind === 'failed'
        ? now.reason
        : now.kind === 'loading'
          ? `Loading ${Math.floor((now.read / now.size) * 100)}% · ${formatBytes(now.size)}`
          : formatBytes(now.size)
  }
  const progress = () => {
    const now = state()
    return now.kind === 'loading' ? (now.read / now.size) * 100 : undefined
  }
  return (
    <span
      class="my-1 inline-block w-full max-w-md overflow-hidden align-top rounded-md border border-border/80 bg-terminal not-prose"
      data-ui="media-card"
      ref={keys}
      title={props.path}
    >
      <Show when={video() && playing()}>
        {(shown) => (
          <video
            autoplay
            class="block aspect-video w-full bg-black"
            controls
            playsinline
            ref={(element) => (player = element)}
            src={shown().url}
          >
            <Show when={shown().captions}>
              {(track) => (
                <track default={captions()} kind="subtitles" label="Captions" src={track()} />
              )}
            </Show>
          </video>
        )}
      </Show>
      <span class="flex items-center gap-2.5 px-2.5 py-2">
        <Show
          when={state().kind === 'ready'}
          fallback={
            <span class="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
              <Switch fallback={<FileAudioIcon class="size-5" stroke-width={1.5} />}>
                <Match when={state().kind === 'loading' || state().kind === 'checking'}>
                  <LoaderCircleIcon class="size-5 motion-safe:animate-spin" />
                </Match>
                <Match when={video()}>
                  <FileVideoIcon class="size-5" stroke-width={1.5} />
                </Match>
              </Switch>
            </span>
          }
        >
          <Button
            aria-label={`Play ${name()}`}
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85"
            onClick={play}
            size={null}
            variant={null}
          >
            <PlayIcon class="size-4 translate-x-px" fill="currentColor" />
          </Button>
        </Show>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] leading-5 text-foreground/90">{props.label}</span>
          <span
            class={cn(
              'block truncate text-[11px] leading-4 text-muted-foreground',
              state().kind === 'failed' && 'text-destructive/80',
            )}
          >
            {props.label === name() ? note() : `${name()} · ${note()}`}
          </span>
        </span>
      </span>
      <Show when={progress() !== undefined}>
        <span class="block h-0.5 bg-border/60">
          <span class="block h-full bg-brand transition-[width]" style={{ width: `${progress()}%` }} />
        </span>
      </Show>
      <Show when={!video() && playing()}>
        {(shown) => (
          <audio
            autoplay
            class="block h-10 w-full px-1.5 pb-1.5"
            controls
            ref={(element) => (player = element)}
            src={shown().url}
          />
        )}
      </Show>
    </span>
  )
}

type Target = { kind: 'deck' | 'text' | 'media'; path: string; type: string }

/** `href` as a path, or undefined for a malformed escape, which is not a path the server could find. */
function decoded(href: string) {
  try {
    return decodeURI(href)
  } catch {
    return undefined
  }
}

function FileLink(props: { target: Target; href: string; children: JSX.Element }) {
  const content = children(() => props.children)
  const label = () => {
    const parts = content.toArray()
    const text = parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : ''
    return text && text !== props.href ? text : (props.target.path.split('/').at(-1) ?? '')
  }
  return (
    <Switch>
      <Match when={props.target.kind === 'deck'}>
        <DeckCard path={props.target.path} />
      </Match>
      <Match when={props.target.kind === 'text'}>
        <TextCard label={label()} path={props.target.path} />
      </Match>
      <Match when={props.target.kind === 'media'}>
        <MediaCard label={label()} path={props.target.path} type={props.target.type} />
      </Match>
    </Switch>
  )
}

const MediaLink: LinkRenderer = (props) => {
  const target = createMemo(
    (): Target | undefined => {
      const type = mediaType(props.href) ?? ''
      const kind = isDeck(props.href) ? 'deck' : isText(props.href) ? 'text' : type ? 'media' : undefined
      const path = kind && decoded(props.href)
      return kind && path !== undefined ? { kind, path, type } : undefined
    },
    { equals: (a, b) => a?.path === b?.path },
  )
  return (
    <Show when={target()} fallback={props.core} keyed>
      {(file) => (
        <FileLink href={props.href} target={file}>
          {props.children}
        </FileLink>
      )}
    </Show>
  )
}

const MediaCode: InlineCodeRenderer = (props) => (
  <Show when={isPathCandidate(props.code)} fallback={props.core}>
    <PathCode code={props.code} core={props.core} />
  </Show>
)

export default defineWebExtension({ inlineCode: MediaCode, link: MediaLink })
