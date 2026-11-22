/** @jsxImportSource @solidjs/web */
import type { ConversationId } from '@earendil-works/pi-durable'
import {
  Bell,
  CarFront,
  LoaderCircle,
  Mic,
  Pause,
  RotateCcw,
  Send,
  Square,
  Volume2,
  X,
} from '@lucide/solid'
import { createEffect, createMemo, createSignal, Match, onCleanup, Show, Switch } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import {
  actionRef,
  api,
  cn,
  defineWebExtension,
  docRef,
  errorMessage,
  keepLast,
  ROOT,
  ScopedConversation,
  useAction,
  useConversation,
  useConversations,
  useDocOf,
  useNow,
  usePageVisible,
  UserView,
} from '@/sdk/solid'
import type { SolidEntryProps } from '@/sdk/solid'
import { meansNone } from '@/../../lib/errors.ts'
import type { Board } from './types.ts'
import { entrySpeech, messageSpeech, plain, sentences } from './speech.ts'
import type { Utterance } from './speech.ts'

/** How often the shown screen restarts the speech engines' idle clocks. */
const KEEP_WARM_MS = 60_000
// This screen's actions (server.ts), and the other extensions' documents and actions it uses, by name.
/** No arguments → `{ voice }`: starts both speech engines (or restarts their idle clocks), so neither starts cold. */
const WarmAction = actionRef<null, { voice: string }>('drive', 'warm')
/** `{ text }` (at most 2000 characters) → `{ audio }`: base64 24 kHz WAV of it in `drive.voice`. */
const SpeakAction = actionRef<{ text: string }, { audio: string }>('drive', 'speak')
/**
 * `{ text, re?, project? }` → `{ conversation }` or `{ answered }`: a spoken input to @ultimate, or the reply to message
 * `re`; with `project`, in that project's instance.
 */
const AskAction = actionRef<
  { text: string; re?: number; project?: string },
  { conversation: number } | { answered: number }
>('drive', 'ask')
/** `{ project, message }` → `{ text }`: another project's open message as it is read aloud. */
const QuestionAction = actionRef<{ project: string; message: number }, { text: string }>(
  'drive',
  'question',
)
/** The fleet extension's `overview`: every project's state and the messages waiting on the user (`fleet/model.ts`). */
const OverviewAction = actionRef<
  null,
  {
    rows: { name: string; current: boolean; waiting: { message: number; text: string }[] }[]
  }
>('fleet', 'overview')
/** How often the shown screen looks for other projects' new questions. */
const OTHERS_MS = 20_000
/** voice's `transcribe`: `{ audio, mimeType }` (base64) → `{ text }`, through `voice.transcriptionUrl` or OpenAI. */
const TranscribeAction = actionRef<{ audio: string; mimeType: string }, { text: string }>(
  'voice',
  'transcribe',
)
/** The messages extension's `board` document. */
const MessagesDoc = docRef<Board>('board')
/** Each standing agent's conversation by name (subagents' `ultimate.standing-agents`). */
const StandingDoc = docRef<Record<string, ConversationId>>('ultimate.standing-agents')

/** Opus at 24 kbps keeps speech clear for transcription; browsers default to 128 kbps, which fills `MAX_BYTES` in 8 minutes. */
const BITS_PER_SECOND = 24_000
/**
 * A recording is sent on its own once it reaches this size, about 40 minutes at `BITS_PER_SECOND`: under voice's 8 MiB
 * `MAX_AUDIO_BYTES`, and base64'd under the 12 MB action request. A spoken warning comes a minute before.
 */
const MAX_BYTES = 7_500_000
const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']

type Phase = 'idle' | 'listening' | 'paused' | 'transcribing' | 'thinking' | 'speaking'
const WORDS: Record<Phase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening',
  paused: 'Paused',
  transcribing: 'Transcribing',
  thinking: 'Thinking',
  speaking: 'Speaking',
}
/** What a tap on the big button does in each phase. */
const TAP: Record<Phase, string> = {
  idle: 'Talk',
  listening: 'Send',
  paused: 'Send',
  transcribing: 'Wait',
  thinking: 'Talk',
  speaking: 'Talk',
}

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}
const bytesOf = (audio: string) => Uint8Array.from(atob(audio), (c) => c.charCodeAt(0)).buffer

/**
 * Plays utterances one sentence at a time through one AudioContext, fetching the next sentence's WAV while the current
 * one plays. A browser lets the context start only after a tap: `unlock` is called from one.
 */
function createPlayer(onChange: (speaking: boolean) => void) {
  let audio: AudioContext | undefined
  let generation = 0
  let source: AudioBufferSourceNode | undefined
  let chain: Promise<void> = Promise.resolve()
  let pending = 0
  const synth = (text: string) => {
    const clip = api.action(SpeakAction, { text }).then((r) => r.audio)
    // Fetched ahead: a clip dropped by Stop is never awaited, and its failure would surface as unhandled.
    clip.catch(meansNone)
    return clip
  }
  const settle = () => onChange(pending > 0)
  const play = (context: AudioContext, buffer: AudioBuffer) =>
    new Promise<void>((done) => {
      source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.addEventListener('ended', () => done())
      source.start()
    })
  return {
    get unlocked() {
      return audio?.state === 'running'
    },
    async unlock() {
      audio ??= new AudioContext()
      // A failed resume leaves it suspended; `unlocked` says so and the screen asks for another tap.
      await audio.resume().catch(meansNone)
    },
    /** Two soft rising notes, at once and past the speech queue: something new waits. */
    chime() {
      if (!audio) return
      for (const [at, frequency] of [
        [0, 660],
        [0.16, 880],
      ]) {
        const tone = audio.createOscillator()
        const gain = audio.createGain()
        const start = audio.currentTime + at
        tone.frequency.value = frequency
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.2, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3)
        tone.connect(gain).connect(audio.destination)
        tone.start(start)
        tone.stop(start + 0.3)
      }
    },
    /**
     * Speak `text` after whatever is playing; `started` runs once its first sentence plays. Resolves when it is said, rejects
     * when speech failed.
     */
    async say(text: string, started?: () => void) {
      const run = generation
      const pieces = sentences(text)
      if (!pieces.length) return
      pending++
      settle()
      const clips = pieces.map((piece, index) => (index === 0 ? synth(piece) : undefined))
      const said = chain.then(async () => {
        for (const [index, piece] of pieces.entries()) {
          if (run !== generation || !audio) return
          const clip = clips[index] ?? synth(piece)
          if (index + 1 < pieces.length) clips[index + 1] = synth(pieces[index + 1])
          const buffer = await audio.decodeAudioData(bytesOf(await clip))
          if (run !== generation) return
          // Only once its first sound plays has the user heard it.
          const playing = play(audio, buffer)
          if (index === 0) started?.()
          await playing
        }
      })
      // The chain only orders speech: one failed utterance must not silence the ones after it.
      chain = said.catch(meansNone)
      try {
        await said
      } finally {
        pending--
        settle()
      }
    },
    stop() {
      generation++
      source?.stop()
    },
  }
}

/** Keeps the screen on while Drive is shown, taking the lock again whenever the page becomes visible. */
function useWakeLock() {
  const visible = usePageVisible()
  createEffect(visible, (shown) => {
    if (!shown || !('wakeLock' in navigator)) return undefined
    let lock: WakeLockSentinel | undefined
    let gone = false
    navigator.wakeLock.request('screen').then(
      (taken) => {
        if (gone) taken.release().catch(meansNone)
        else lock = taken
      },
      // Refused (battery saver, an old browser): the screen just follows its own timeout.
      meansNone,
    )
    return () => {
      gone = true
      lock?.release().catch(meansNone)
    }
  })
}

/**
 * Everything new for the user since the screen opened, in order: @ultimate's final answers, landings and failures from
 * its transcript, and messages to the user from any conversation. Each is handed to `say` once.
 */
function useNews(main: () => ConversationId, say: (utterance: Utterance) => void) {
  const conversation = useConversation()
  const entries = createMemo(() => conversation().entries)
  const loading = createMemo(() => conversation().loading)
  const board = useDocOf(() => ROOT, MessagesDoc)
  const titles = useConversations()
  let seen: { entry: number; message: number; keys: Set<string> } | undefined
  createEffect(
    () => ({
      rows: entries(),
      loaded: !loading(),
      messages: board()?.messages,
      summaries: titles(),
      ultimate: main(),
    }),
    ({ rows, loaded, messages, summaries, ultimate }) => {
      if (!loaded || !messages) return
      // The first look only marks where "new" starts: nothing from before the screen opened is read.
      if (!seen) {
        seen = {
          entry: rows.at(-1)?.id ?? 0,
          message: messages.at(-1)?.id ?? 0,
          keys: new Set(),
        }
        return
      }
      const mark = seen
      const fresh: Utterance[] = []
      for (const entry of rows) {
        if (entry.id <= mark.entry) continue
        const utterance = entrySpeech(entry)
        if (utterance && !mark.keys.has(utterance.key)) fresh.push(utterance)
      }
      mark.entry = Math.max(mark.entry, rows.at(-1)?.id ?? 0)
      for (const message of messages) {
        if (message.id <= mark.message || message.to !== 'user') continue
        const sender =
          message.from === ultimate || typeof message.from !== 'number'
            ? undefined
            : (summaries.find((c) => c.id === message.from)?.title ?? `Branch ${message.from}`)
        fresh.push({
          key: `message:${message.id}`,
          text: messageSpeech(message, sender),
          ...(message.reply ? { question: message.id } : {}),
        })
      }
      mark.message = Math.max(mark.message, messages.at(-1)?.id ?? 0)
      for (const utterance of fresh) {
        mark.keys.add(utterance.key)
        say(utterance)
      }
    },
  )
}

/**
 * Other projects' new questions to the user, read aloud with the project's name, from the fleet extension's overview
 * (nothing without it). Returns the ones still open there, as `project:message`.
 */
function useOtherQuestions(say: (utterance: Utterance) => void) {
  const visible = usePageVisible()
  // Without the fleet extension there is nothing to hear; a failed poll is asked again next time.
  const overview = useAction(OverviewAction, null, {
    every: () => (visible() ? OTHERS_MS : undefined),
    onError: keepLast,
  })
  const waiting = createMemo(() =>
    (overview.data()?.rows ?? [])
      .filter((row) => !row.current)
      .flatMap((row) =>
        row.waiting.map((w) => ({ ...w, project: row.name, key: `${row.name}:${w.message}` })),
      ),
  )
  let seen: Set<string> | undefined
  /** The new questions in the order they came, each read once the one before it is said. */
  let reading = Promise.resolve()
  let gone = false
  onCleanup(() => {
    gone = true
  })
  createEffect(
    () => (overview.data() ? waiting() : undefined),
    (open) => {
      if (!open) return
      // The first look only marks where "new" starts, as in useNews.
      const fresh = seen ? open.filter((w) => !seen!.has(w.key)) : []
      seen = new Set([...(seen ?? []), ...open.map((w) => w.key)])
      for (const { project, message, text, key } of fresh)
        reading = reading
          .then(() => api.action(QuestionAction, { project, message }))
          // Its full questions could not be read: its gist still says what waits.
          .catch(() => ({ text: `${project} says: ${plain(text)}` }))
          .then((question) => {
            if (gone) return
            say({
              key: `remote:${key}`,
              text: `${question.text} Your reply goes to ${project}.`,
              question: message,
              project,
            })
          })
    },
  )
  return createMemo(() => new Set(waiting().map((w) => w.key)))
}

/** The open message a recording answers, in `project`'s instance when it is another project's. */
type Target = { re: number; project?: string }
type Recording = {
  recorder: MediaRecorder
  stream: MediaStream
  cancelled: boolean
  /** The question heard when recording began: what this recording answers. */
  target?: Target
  /** Whether the minute-left warning was said. */
  warned: boolean
  began: number
  /** Set while paused to listen; `pausedMs` sums the pauses before. */
  pausedAt?: number
  pausedMs: number
}
/** How long `taking` has recorded at `now`, pauses left out. */
const recorded = (taking: Recording, now = Date.now()) =>
  (taking.pausedAt ?? now) - taking.began - taking.pausedMs
/** A recording whose sending failed, kept so Try again sends it without speaking again; `text` once transcribed. */
type Failed = { audio: Blob; target?: Target; text?: string }

/** A soft red halo behind the button that swells with the microphone level, so speaking visibly registers. */
function LevelHalo(props: { stream: MediaStream }) {
  let halo: HTMLSpanElement | undefined
  createEffect(
    () => props.stream,
    (stream) => {
      const audio = new AudioContext()
      const analyser = audio.createAnalyser()
      analyser.fftSize = 256
      const source = audio.createMediaStreamSource(stream)
      source.connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      let level = 0
      let frame = requestAnimationFrame(function draw() {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2
        // Rise fast, fall slowly: the halo breathes with the voice instead of flickering.
        const target = Math.min(1, Math.sqrt(sum / samples.length) * 5)
        level = target > level ? target : level * 0.9
        if (halo) halo.style.transform = `scale(${1.04 + 0.16 * level})`
        frame = requestAnimationFrame(draw)
      })
      return () => {
        cancelAnimationFrame(frame)
        source.disconnect()
        // Closing only frees the meter's own context; nothing waits on it.
        audio.close().catch(meansNone)
      }
    },
  )
  return (
    <span
      aria-hidden="true"
      class="absolute inset-0 scale-[1.04] rounded-full bg-error/25 motion-reduce:hidden"
      ref={(element) => {
        halo = element
      }}
    />
  )
}

/** How long `taking` has recorded, as m:ss; `warned` adds that a minute is left. */
function Elapsed(props: { taking: Recording; warned: boolean }) {
  const now = useNow(500)
  const seconds = () => Math.max(0, Math.floor(recorded(props.taking, now()) / 1000))
  return (
    <span class="tabular-nums">
      {Math.floor(seconds() / 60)}:{String(seconds() % 60).padStart(2, '0')}
      <Show when={props.warned}>
        <span class="text-warning"> · 1 min left</span>
      </Show>
    </span>
  )
}

function Drive() {
  const standing = useDocOf(() => ROOT, StandingDoc)
  return (
    <Show
      when={standing()?.ultimate}
      keyed
      fallback={<div class="flex flex-1 items-center justify-center text-muted-foreground">…</div>}
    >
      {(main) => (
        <ScopedConversation id={main}>
          <DriveScreen main={main} />
        </ScopedConversation>
      )}
    </Show>
  )
}

function DriveScreen(props: { main: ConversationId }) {
  useWakeLock()
  const conversation = useConversation()
  const [speaking, setSpeaking] = createSignal(false)
  const player = createPlayer(setSpeaking)
  let active: Recording | undefined
  const [recording, setRecording] = createSignal(false)
  const [paused, setPaused] = createSignal(false)
  const [warned, setWarned] = createSignal(false)
  /** News that came while the user spoke, held until they listen or the recording ends. */
  let held: Utterance[] = []
  const [heldCount, setHeldCount] = createSignal(0)
  const [failed, setFailed] = createSignal<Failed>()
  const [transcribing, setTranscribing] = createSignal(false)
  const [asked, setAsked] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [heard, setHeard] = createSignal<string>()
  const [last, setLast] = createSignal<Utterance>()
  const [locked, setLocked] = createSignal(false)
  const [question, setQuestion] = createSignal<Target>()
  const board = useDocOf(() => ROOT, MessagesDoc)
  const visible = usePageVisible()

  // Both engines take seconds to load cold: start them as the screen opens, and keep them warm while it is shown.
  const warmed = useAction(WarmAction, null, {
    every: () => (visible() ? KEEP_WARM_MS : undefined),
    onError: keepLast,
  })
  const voice = () => warmed.data()?.voice
  const shownError = () => {
    const failure = warmed.error()
    return error() ?? (failure && errorMessage(failure))
  }

  /** What arrived while audio was still locked, played in order once a tap unlocks it. */
  let waiting: Utterance[] = []
  const play = (utterance: Utterance) => {
    setLast(utterance)
    player
      .say(utterance.text, () => {
        // A spoken answer goes to the question the user has heard, not one still queued behind it.
        if (utterance.question !== undefined)
          setQuestion({
            re: utterance.question,
            ...(utterance.project ? { project: utterance.project } : {}),
          })
      })
      .catch((failure: unknown) => setError(errorMessage(failure)))
  }
  const say = (utterance: Utterance) => {
    setAsked(false)
    setError(undefined)
    // Never spoken over the user: a chime now, the news when they listen or stop.
    if (active && active.pausedAt === undefined) {
      held.push(utterance)
      setHeldCount(held.length)
      player.chime()
    } else if (player.unlocked) play(utterance)
    else {
      waiting.push(utterance)
      setLast(utterance)
      setLocked(true)
    }
  }
  useNews(() => props.main, say)
  const openElsewhere = useOtherQuestions(say)
  const openQuestion = createMemo(() => {
    const target = question()
    if (!target) return undefined
    const open = target.project
      ? openElsewhere().has(`${target.project}:${target.re}`)
      : board()?.messages.some((m) => m.id === target.re && m.state === 'delivered' && m.reply)
    return open ? target : undefined
  })
  /** Play the news held while the user spoke. */
  const hear = () => {
    setHeldCount(0)
    for (const utterance of held.splice(0)) play(utterance)
  }
  /** After a tap unlocked audio: play everything that waited for it. */
  const drain = () => {
    setLocked(false)
    for (const utterance of waiting.splice(0)) play(utterance)
  }

  /** Say a short notice; it is not kept for Replay. */
  const notice = (text: string) => {
    player.say(text).catch((failure: unknown) => setError(errorMessage(failure)))
  }

  async function send(audio: Blob, target: Target | undefined, transcribed?: string) {
    setTranscribing(true)
    setError(undefined)
    setFailed(undefined)
    let text = transcribed
    try {
      text ??= (
        await api.action(TranscribeAction, { audio: await base64(audio), mimeType: audio.type })
      ).text
      if (!text) {
        setError('No speech heard')
        return
      }
      setHeard(text)
      await api.action(AskAction, { text, ...target })
      if (target) setQuestion((current) => (current === target ? undefined : current))
      setAsked(true)
    } catch (failure) {
      // Nothing said is lost: the recording (or its text) waits for Try again.
      setFailed({ audio, target, text })
      setError(errorMessage(failure))
      notice('That did not go through. Tap Try again to send it.')
    } finally {
      setTranscribing(false)
    }
  }

  /** Set while the browser is asked for the microphone, so a second tap does not open a second recorder. */
  let starting = false
  let gone = false
  async function start() {
    if (starting) return
    starting = true
    const target = openQuestion()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch (failure) {
      starting = false
      setError(
        failure instanceof DOMException && failure.name === 'NotAllowedError'
          ? 'Microphone blocked: allow it in site settings'
          : `No microphone: ${errorMessage(failure)}`,
      )
      return
    }
    starting = false
    // The screen closed while the browser asked: free the microphone at once.
    if (gone) {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    const type = TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate))
    const recorder = new MediaRecorder(stream, {
      audioBitsPerSecond: BITS_PER_SECOND,
      ...(type ? { mimeType: type } : {}),
    })
    const taking: Recording = {
      recorder,
      stream,
      cancelled: false,
      target,
      warned: false,
      began: Date.now(),
      pausedMs: 0,
    }
    const chunks: Blob[] = []
    let bytes = 0
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size === 0) return
      chunks.push(event.data)
      bytes += event.data.size
      if (active !== taking) return
      // Time left until MAX_BYTES at the rate recorded so far: the browser may not honour BITS_PER_SECOND.
      const left = ((MAX_BYTES - bytes) / bytes) * recorded(taking)
      if (left <= 0) {
        finish(false)
        notice('That is the limit, so I sent it.')
      } else if (left <= 60_000 && !taking.warned) {
        taking.warned = true
        setWarned(true)
        notice('One minute left.')
      }
    })
    recorder.addEventListener('stop', () => {
      for (const track of stream.getTracks()) track.stop()
      if (taking.cancelled || !chunks.length) return
      send(
        new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }),
        taking.target,
      ).catch((failure: unknown) => setError(errorMessage(failure)))
    })
    recorder.start(1000)
    active = taking
    setWarned(false)
    setRecording(true)
  }

  function finish(cancel: boolean) {
    const taking = active
    if (!taking) return
    active = undefined
    taking.cancelled = cancel
    if (taking.recorder.state !== 'inactive') taking.recorder.stop()
    setRecording(false)
    setPaused(false)
    // Sent or dropped, the user is free to hear what came meanwhile.
    if (!gone) hear()
  }

  /** Listen first: pause the recording and play the held news; the recording goes on or is sent after. */
  async function listen() {
    await player.unlock()
    const taking = active
    if (!taking || taking.pausedAt !== undefined) return
    taking.recorder.pause()
    taking.pausedAt = Date.now()
    setPaused(true)
    hear()
  }
  /** Keep talking: stop the news and record on into the same recording. */
  function resume() {
    const taking = active
    if (!taking || taking.pausedAt === undefined) return
    player.stop()
    taking.pausedMs += Date.now() - taking.pausedAt
    taking.pausedAt = undefined
    taking.recorder.resume()
    setPaused(false)
  }
  function discard() {
    notice('Discarded.')
    finish(true)
  }

  // Leaving the screen drops a recording and the speech.
  onCleanup(() => {
    gone = true
    finish(true)
    player.stop()
  })

  /** Every tap also unlocks audio: the browser lets a page play sound only after one. */
  async function talk() {
    await player.unlock()
    if (active) {
      drain()
      finish(false)
      return
    }
    player.stop()
    // What waited for the unlock is dropped by talking over it; Replay still has the last one.
    waiting = []
    setLocked(false)
    setError(undefined)
    // Not awaited: the engines warm up while the user speaks.
    void warmed.refetch()
    if (!window.isSecureContext) setError('The microphone needs HTTPS: open the tailnet URL')
    else await start()
  }
  const replay = async () => {
    await player.unlock()
    if (waiting.length) return drain()
    player.stop()
    const said = last()
    if (said) play(said)
  }
  const retry = async () => {
    await player.unlock()
    player.stop()
    const kept = failed()
    if (kept) await send(kept.audio, kept.target, kept.text)
  }

  const phase = createMemo<Phase>(() =>
    recording()
      ? paused()
        ? 'paused'
        : 'listening'
      : transcribing()
        ? 'transcribing'
        : speaking()
          ? 'speaking'
          : asked() || conversation().busy
            ? 'thinking'
            : 'idle',
  )

  const taking = () => (recording() ? active : undefined)
  const stream = () => (phase() === 'listening' ? taking()?.stream : undefined)
  const asking = () => openQuestion() !== undefined && !recording()
  const heldFrom = () => (heldCount() > 0 ? held.at(-1)?.project : undefined)
  /** One of the big buttons under the talk button. */
  const big =
    'flex h-20 flex-1 items-center justify-center gap-3 rounded-2xl bg-muted/60 text-xl font-medium active:bg-muted disabled:opacity-30 data-disabled:opacity-30 landscape:h-16'

  const tap = () => (asking() ? 'Answer' : TAP[phase()])

  // Portrait stacks status, button and controls; landscape (a phone in a car mount) puts the button on the left.
  return (
    <main
      class="dark grid min-h-0 flex-1 grid-rows-[auto_1fr_auto] place-items-center gap-x-10 gap-y-6 overflow-hidden bg-background px-6 pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-foreground select-none landscape:grid-cols-[auto_minmax(0,28rem)] landscape:grid-rows-[auto_auto] landscape:place-content-center landscape:py-6"
      data-drive={phase()}
    >
      <section class="flex w-full max-w-md flex-col items-center gap-3 text-center landscape:col-start-2 landscape:row-start-1 landscape:self-end landscape:pt-4">
        <p
          aria-live="polite"
          class={cn(
            'flex items-center gap-3 text-5xl font-semibold tracking-tight',
            phase() === 'listening' && 'text-error',
            phase() === 'paused' && 'text-warning',
            phase() === 'speaking' && 'text-brand',
            phase() === 'idle' && 'text-muted-foreground',
          )}
        >
          <Switch>
            <Match when={phase() === 'listening'}>
              <span class="size-4 shrink-0 rounded-full bg-error motion-safe:animate-pulse" />
            </Match>
            <Match when={phase() === 'speaking'}>
              <Volume2 class="size-10 shrink-0" />
            </Match>
            <Match when={phase() === 'paused'}>
              <Pause class="size-10 shrink-0 fill-current" />
            </Match>
          </Switch>
          <span>
            {WORDS[phase()]}
            <Show when={phase() === 'thinking' || phase() === 'transcribing'}>
              <span class="motion-safe:animate-pulse">…</span>
            </Show>
          </span>
        </p>
        {/* One quiet line under the word; it always takes its room so the button never jumps. */}
        <div class="flex min-h-14 items-start justify-center text-xl">
          <Switch>
            <Match when={shownError()}>
              <p class="line-clamp-2 text-error wrap-anywhere" role="alert">
                {shownError()}
              </p>
            </Match>
            <Match when={taking()}>
              {(current) => (
                <div class="flex flex-col items-center gap-1 text-muted-foreground">
                  <Elapsed taking={current()} warned={warned()} />
                  <Show when={heldCount() > 0}>
                    <p class="flex items-center gap-2 text-brand">
                      <Bell class="size-5" />
                      {heldCount() === 1 ? 'New message' : `${heldCount()} new messages`}
                      {heldFrom() && ` · ${heldFrom()}`}
                    </p>
                  </Show>
                </div>
              )}
            </Match>
            <Match when={asking()}>
              <p class="flex items-center gap-1 rounded-full bg-warning/15 py-1 pr-1 pl-4 text-lg whitespace-nowrap text-warning">
                Your answer goes to {openQuestion()?.project ?? 'the question'}
                <Button
                  aria-label="Talk normally instead"
                  class="grid size-10 shrink-0 place-items-center rounded-full text-warning/80 active:bg-warning/20"
                  onClick={() => setQuestion(undefined)}
                  size={null}
                  variant={null}
                >
                  <X class="size-6" />
                </Button>
              </p>
            </Match>
            <Match when={heard() && phase() !== 'idle'}>
              <p class="line-clamp-2 text-muted-foreground">“{heard()}”</p>
            </Match>
          </Switch>
        </div>
      </section>

      <div class="relative size-[min(76vw,46svh,24rem)] landscape:col-start-1 landscape:row-span-2 landscape:row-start-1 landscape:size-[min(40vw,62svh,22rem)]">
        <Show when={stream()}>{(current) => <LevelHalo stream={current()} />}</Show>
        <Button
          aria-label={tap()}
          class={cn(
            'relative grid size-full place-items-center rounded-full border-4 transition-colors duration-200',
            phase() === 'listening'
              ? 'border-error bg-error text-background'
              : phase() === 'paused'
                ? 'border-warning bg-warning text-background'
                : phase() === 'speaking'
                  ? 'border-brand/60 bg-muted/40 text-foreground active:bg-muted'
                  : 'border-border bg-muted/40 text-foreground active:bg-muted',
            phase() === 'transcribing' && 'text-muted-foreground',
          )}
          disabled={transcribing()}
          onClick={talk}
          size={null}
          variant={null}
        >
          <span class="flex flex-col items-center gap-2">
            <Switch fallback={<Mic class="size-20" />}>
              <Match when={recording()}>
                <Send class="size-20" />
              </Match>
              <Match when={phase() === 'transcribing'}>
                <LoaderCircle class="size-20 motion-safe:animate-spin" />
              </Match>
            </Switch>
            <Show when={phase() !== 'transcribing'}>
              <span class="text-2xl font-semibold">{tap()}</span>
            </Show>
          </span>
        </Button>
      </div>

      <nav class="flex w-full max-w-md flex-col gap-3 landscape:col-start-2 landscape:row-start-2 landscape:self-start">
        <Show when={failed() && !recording() && !transcribing()}>
          <Button
            class="flex h-16 items-center justify-center gap-3 rounded-2xl bg-error/20 text-xl font-medium text-error active:bg-error/30"
            onClick={retry}
            size={null}
            variant={null}
          >
            <RotateCcw class="size-7" /> Try again
          </Button>
        </Show>
        <Show when={locked()}>
          <Button
            class="flex h-16 items-center justify-center gap-3 rounded-2xl bg-brand/20 text-xl font-medium text-brand active:bg-brand/30"
            onClick={replay}
            size={null}
            variant={null}
          >
            <Volume2 class="size-7" /> Tap to hear it
          </Button>
        </Show>
        {/* While recording: listen to what came, go on after listening, or drop the recording. */}
        <Show
          when={recording()}
          fallback={
            <div class="flex gap-3">
              <Button class={big} disabled={!last()} onClick={replay} size={null} variant={null}>
                <RotateCcw class="size-7" /> Replay
              </Button>
              <Button
                class={big}
                disabled={!speaking()}
                onClick={() => player.stop()}
                size={null}
                variant={null}
              >
                <Square class="size-6 fill-current" /> Stop
              </Button>
            </div>
          }
        >
          <div class="flex gap-3">
            <Switch>
              <Match when={paused()}>
                <Button class={big} onClick={resume} size={null} variant={null}>
                  <Mic class="size-7" /> Keep talking
                </Button>
              </Match>
              <Match when={heldCount() > 0}>
                <Button
                  class={cn(big, 'bg-brand/20 text-brand active:bg-brand/30')}
                  onClick={listen}
                  size={null}
                  variant={null}
                >
                  <Volume2 class="size-7" /> Listen first
                </Button>
              </Match>
            </Switch>
            <Button class={big} onClick={discard} size={null} variant={null}>
              <X class="size-7" /> Discard
            </Button>
          </div>
        </Show>
        {/* Underdog Woof's licence asks apps that use it to show this credit. */}
        <Show when={voice()?.startsWith('woof:')}>
          <p class="text-center text-xs text-muted-foreground/70">Voice by Underdog Woof</p>
        </Show>
      </nav>
    </main>
  )
}

/** In @ultimate: what the user said on the Drive screen, as their turn, without the speaking instruction. */
function SpokenRow(props: SolidEntryProps) {
  const message = () => {
    const first = props.entry.model?.[0]
    return first?.role === 'user' ? first : undefined
  }
  return (
    <Show when={message()}>
      {(user) => (
        <div data-drive-spoken="">
          <UserView
            entry={props.entry}
            message={user()}
            text={(props.entry.data as { text: string }).text}
          />
          <p class="-mt-3 flex items-center justify-end gap-1 font-mono text-[11px] text-muted-foreground">
            <CarFront class="size-3" /> spoken
          </p>
        </div>
      )}
    </Show>
  )
}

export default defineWebExtension({
  entries: { 'drive.spoken': SpokenRow },
  // In @ultimate's compact transcript a spoken turn is the user's turn, as a typed one is, never folded away.
  compact: {
    when: (conversation, docs) =>
      (docs[StandingDoc.kind] as Record<string, ConversationId> | null | undefined)?.ultimate ===
      conversation.id,
    docs: [StandingDoc.kind],
    thread: ({ entry }) => entry.kind === 'drive.spoken',
  },
  surfaces: [
    {
      id: 'drive',
      title: 'Drive',
      icon: CarFront,
      description: 'Talk to @ultimate by voice; it answers aloud',
      order: 50,
      component: Drive,
    },
  ],
})
