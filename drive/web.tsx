import type { EntryRecord } from '@earendil-works/pi-durable'
import {
  CarFrontIcon,
  LoaderCircleIcon,
  MicIcon,
  RotateCcwIcon,
  SendIcon,
  SquareIcon,
  Volume2Icon,
  XIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  actionRef,
  api,
  cn,
  ConversationScope,
  defineWebExtension,
  docRef,
  errorMessage,
  useConversation,
  useConversations,
  useDocOf,
  useNow,
  UserView,
} from '@/sdk'
import type { Board } from './types.ts'
import { entrySpeech, messageSpeech, sentences } from './speech.ts'
import type { Utterance } from './speech.ts'

/** How often the shown screen restarts the speech engines' idle clocks. */
const KEEP_WARM_MS = 60_000
/** Recordings stop on their own here, well inside what transcription takes. */
// This screen's actions (server.ts), and the other extensions' documents and actions it uses, by name.
/** No arguments → `{ voice }`: starts both speech engines (or restarts their idle clocks), so neither starts cold. */
const WarmAction = actionRef<null, { voice: string }>('drive', 'warm')
/** `{ text }` (at most 2000 characters) → `{ audio }`: base64 24 kHz WAV of it in `drive.voice`. */
const SpeakAction = actionRef<{ text: string }, { audio: string }>('drive', 'speak')
/** `{ text, re? }` → `{ conversation }` or `{ answered }`: a spoken input to @ultimate, or the reply to message `re`. */
const AskAction = actionRef<
  { text: string; re?: number },
  { conversation: number } | { answered: number }
>('drive', 'ask')
/** voice's `transcribe`: `{ audio, mimeType }` (base64) → `{ text }`, through `voice.transcriptionUrl` or OpenAI. */
const TranscribeAction = actionRef<{ audio: string; mimeType: string }, { text: string }>(
  'voice',
  'transcribe',
)
/** The messages extension's `board` document. */
const MessagesDoc = docRef<Board>('board')
/** Each standing agent's conversation by name (subagents' `ultimate.standing-agents`). */
const StandingDoc = docRef<Record<string, number>>('ultimate.standing-agents')

const MAX_MS = 2 * 60_000
const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']

type Phase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'
const WORDS: Record<Phase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening',
  transcribing: 'Transcribing',
  thinking: 'Thinking',
  speaking: 'Speaking',
}
/** What a tap on the big button does in each phase. */
const TAP: Record<Phase, string> = {
  idle: 'Talk',
  listening: 'Send',
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
    clip.catch(() => undefined)
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
      await audio.resume().catch(() => undefined)
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
      chain = said.catch(() => undefined)
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

type Player = ReturnType<typeof createPlayer>

/** Keeps the screen on while Drive is shown, taking the lock again whenever the page becomes visible. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | undefined
    let gone = false
    const take = async () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
      // Refused (battery saver, an old browser): the screen just follows its own timeout.
      lock = await navigator.wakeLock.request('screen').catch(() => undefined)
      if (gone) await lock?.release()
    }
    const retake = () => void take()
    retake()
    document.addEventListener('visibilitychange', retake)
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', retake)
      // oxlint-disable-next-line typescript/no-floating-promises -- releasing on unmount has nobody to report to.
      void lock?.release()
    }
  }, [])
}

/**
 * Everything new for the user since the screen opened, in order: @ultimate's final answers, landings and failures from
 * its transcript, and messages to the user from any conversation. Each is handed to `say` once.
 */
function useNews(main: number, say: (utterance: Utterance) => void) {
  const entries = useConversation((conversation) => conversation.entries)
  const loading = useConversation((conversation) => conversation.loading)
  const messages = useDocOf(1, MessagesDoc)?.messages
  const titles = useConversations()
  const seen = useRef<{ entry: number; message: number; keys: Set<string> }>(undefined)
  const speak = useRef(say)
  speak.current = say
  useEffect(() => {
    if (loading || !messages) return
    // The first look only marks where "new" starts: nothing from before the screen opened is read.
    if (!seen.current) {
      seen.current = {
        entry: entries.at(-1)?.id ?? 0,
        message: messages.at(-1)?.id ?? 0,
        keys: new Set(),
      }
      return
    }
    const mark = seen.current
    const fresh: { utterance: Utterance }[] = []
    for (const entry of entries) {
      if (entry.id <= mark.entry) continue
      const utterance = entrySpeech(entry)
      if (utterance && !mark.keys.has(utterance.key)) fresh.push({ utterance })
    }
    mark.entry = Math.max(mark.entry, entries.at(-1)?.id ?? 0)
    for (const message of messages) {
      if (message.id <= mark.message || message.to !== 'user') continue
      const sender =
        message.from === main || typeof message.from !== 'number'
          ? undefined
          : (titles.find((c) => c.id === message.from)?.title ?? `Branch ${message.from}`)
      fresh.push({
        utterance: {
          key: `message:${message.id}`,
          text: messageSpeech(message, sender),
          ...(message.reply ? { question: message.id } : {}),
        },
      })
    }
    mark.message = Math.max(mark.message, messages.at(-1)?.id ?? 0)
    for (const { utterance } of fresh) {
      mark.keys.add(utterance.key)
      speak.current(utterance)
    }
  }, [entries, loading, messages, main, titles])
}

type Recording = {
  recorder: MediaRecorder
  stream: MediaStream
  cancelled: boolean
  /** The question heard when recording began: what this recording answers. */
  re?: number
}

/** A soft red halo behind the button that swells with the microphone level, so speaking visibly registers. */
function LevelHalo({ stream }: { stream: MediaStream }) {
  const halo = useRef<HTMLSpanElement>(null)
  useEffect(() => {
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
      if (halo.current) halo.current.style.transform = `scale(${1.04 + 0.16 * level})`
      frame = requestAnimationFrame(draw)
    })
    return () => {
      cancelAnimationFrame(frame)
      source.disconnect()
      // Closing only frees the meter's own context; nothing waits on it.
      void audio.close().catch(() => undefined)
    }
  }, [stream])
  return (
    <span
      aria-hidden
      className="absolute inset-0 scale-[1.04] rounded-full bg-error/25 motion-reduce:hidden"
      ref={halo}
    />
  )
}

/** Time since this mounted, as m:ss: how long the current recording runs. */
function Elapsed() {
  const [started] = useState(Date.now)
  const seconds = Math.max(0, Math.floor((useNow(500) - started) / 1000))
  return (
    <span className="tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  )
}

function Drive() {
  const main = useDocOf(1, StandingDoc)?.ultimate
  if (main === undefined)
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">…</div>
  return (
    <ConversationScope id={main}>
      <DriveScreen main={main} />
    </ConversationScope>
  )
}

function DriveScreen({ main }: { main: number }) {
  useWakeLock()
  const busy = useConversation((conversation) => conversation.busy)
  const [speaking, setSpeaking] = useState(false)
  const player = useRef<Player>(undefined)
  player.current ??= createPlayer(setSpeaking)
  const active = useRef<Recording>(undefined)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [asked, setAsked] = useState(false)
  const [error, setError] = useState<string>()
  const [heard, setHeard] = useState<string>()
  const [last, setLast] = useState<Utterance>()
  const [locked, setLocked] = useState(false)
  const [question, setQuestion] = useState<number>()
  const messages = useDocOf(1, MessagesDoc)?.messages
  const openQuestion =
    question !== undefined &&
    messages?.some((m) => m.id === question && m.state === 'delivered' && m.reply)
      ? question
      : undefined

  // Both engines take seconds to load cold: start them as the screen opens, and keep them warm while it is shown.
  const warm = () => {
    api.action(WarmAction).catch((failure: unknown) => setError(errorMessage(failure)))
  }
  useEffect(() => {
    warm()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') warm()
    }, KEEP_WARM_MS)
    const shown = () => {
      if (document.visibilityState === 'visible') warm()
    }
    document.addEventListener('visibilitychange', shown)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [])

  /** What arrived while audio was still locked, played in order once a tap unlocks it. */
  const waiting = useRef<Utterance[]>([])
  const play = (utterance: Utterance) => {
    setLast(utterance)
    // oxlint-disable-next-line typescript/no-floating-promises -- failures show on screen.
    void player
      .current!.say(utterance.text, () => {
        // A spoken answer goes to the question the user has heard, not one still queued behind it.
        if (utterance.question !== undefined) setQuestion(utterance.question)
      })
      .catch((failure: unknown) => setError(errorMessage(failure)))
  }
  const say = (utterance: Utterance) => {
    setAsked(false)
    setError(undefined)
    if (player.current!.unlocked) play(utterance)
    else {
      waiting.current.push(utterance)
      setLast(utterance)
      setLocked(true)
    }
  }
  useNews(main, say)
  /** After a tap unlocked audio: play everything that waited for it. */
  const drain = () => {
    setLocked(false)
    for (const utterance of waiting.current.splice(0)) play(utterance)
  }

  async function send(audio: Blob, re: number | undefined) {
    setTranscribing(true)
    setError(undefined)
    try {
      const { text } = await api.action(TranscribeAction, {
        audio: await base64(audio),
        mimeType: audio.type,
      })
      if (!text) {
        setError('No speech heard')
        return
      }
      setHeard(text)
      await api.action(AskAction, re !== undefined ? { text, re } : { text })
      if (re !== undefined) setQuestion((current) => (current === re ? undefined : current))
      setAsked(true)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setTranscribing(false)
    }
  }

  /** Set while the browser is asked for the microphone, so a second tap does not open a second recorder. */
  const starting = useRef(false)
  const gone = useRef(false)
  async function start() {
    if (starting.current) return
    starting.current = true
    const re = openQuestion
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch (failure) {
      starting.current = false
      setError(
        failure instanceof DOMException && failure.name === 'NotAllowedError'
          ? 'Microphone blocked: allow it in site settings'
          : `No microphone: ${errorMessage(failure)}`,
      )
      return
    }
    starting.current = false
    // The screen closed while the browser asked: free the microphone at once.
    if (gone.current) {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    const type = TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate))
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const taking: Recording = { recorder, stream, cancelled: false, re }
    const chunks: Blob[] = []
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })
    recorder.addEventListener('stop', () => {
      for (const track of stream.getTracks()) track.stop()
      if (taking.cancelled || !chunks.length) return
      // oxlint-disable-next-line typescript/no-floating-promises -- send shows its own failures on screen.
      void send(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }), taking.re)
    })
    recorder.start(1000)
    active.current = taking
    setRecording(true)
  }

  function finish(cancel: boolean) {
    const taking = active.current
    if (!taking) return
    active.current = undefined
    taking.cancelled = cancel
    if (taking.recorder.state !== 'inactive') taking.recorder.stop()
    setRecording(false)
  }

  useEffect(() => {
    if (!recording) return undefined
    const timer = setTimeout(() => finish(false), MAX_MS)
    return () => clearTimeout(timer)
  }, [recording])
  // Leaving the screen drops a recording and the speech.
  useEffect(() => {
    gone.current = false
    return () => {
      gone.current = true
      finish(true)
      player.current?.stop()
    }
  }, [])

  /** Every tap also unlocks audio: the browser lets a page play sound only after one. */
  async function talk() {
    await player.current!.unlock()
    if (recording) {
      drain()
      finish(false)
      return
    }
    player.current!.stop()
    // What waited for the unlock is dropped by talking over it; Replay still has the last one.
    waiting.current = []
    setLocked(false)
    setError(undefined)
    // Not awaited: the engines warm up while the user speaks.
    warm()
    if (!window.isSecureContext) setError('The microphone needs HTTPS: open the tailnet URL')
    else await start()
  }
  const replay = async () => {
    await player.current!.unlock()
    if (waiting.current.length) return drain()
    player.current!.stop()
    if (last) play(last)
  }

  const phase: Phase = recording
    ? 'listening'
    : transcribing
      ? 'transcribing'
      : speaking
        ? 'speaking'
        : asked || busy
          ? 'thinking'
          : 'idle'

  const stream = recording ? active.current?.stream : undefined
  const asking = openQuestion !== undefined && !recording

  const tap = asking ? 'Answer' : TAP[phase]

  // Portrait stacks status, button and controls; landscape (a phone in a car mount) puts the button on the left.
  return (
    <main
      className="dark grid min-h-0 flex-1 grid-rows-[auto_1fr_auto] place-items-center gap-x-10 gap-y-6 overflow-hidden bg-background px-6 pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-foreground select-none landscape:grid-cols-[auto_minmax(0,28rem)] landscape:grid-rows-[auto_auto] landscape:place-content-center landscape:py-6"
      data-drive={phase}
    >
      <section className="flex w-full max-w-md flex-col items-center gap-3 text-center landscape:col-start-2 landscape:row-start-1 landscape:self-end landscape:pt-4">
        <p
          aria-live="polite"
          className={cn(
            'flex items-center gap-3 text-5xl font-semibold tracking-tight',
            phase === 'listening' && 'text-error',
            phase === 'speaking' && 'text-brand',
            phase === 'idle' && 'text-muted-foreground',
          )}
        >
          {phase === 'listening' && (
            <span className="size-4 shrink-0 rounded-full bg-error motion-safe:animate-pulse" />
          )}
          {phase === 'speaking' && <Volume2Icon className="size-10 shrink-0" />}
          <span>
            {WORDS[phase]}
            {(phase === 'thinking' || phase === 'transcribing') && (
              <span className="motion-safe:animate-pulse">…</span>
            )}
          </span>
        </p>
        {/* One quiet line under the word; it always takes its room so the button never jumps. */}
        <div className="flex min-h-14 items-start justify-center text-xl">
          {error ? (
            <p className="line-clamp-2 text-error" role="alert">
              {error}
            </p>
          ) : phase === 'listening' ? (
            <p className="text-muted-foreground">
              <Elapsed />
            </p>
          ) : asking ? (
            <p className="flex items-center gap-1 rounded-full bg-warning/15 py-1 pr-1 pl-4 text-lg whitespace-nowrap text-warning">
              Your answer goes to the question
              <button
                aria-label="Talk normally instead"
                className="grid size-10 shrink-0 place-items-center rounded-full text-warning/80 active:bg-warning/20"
                onClick={() => setQuestion(undefined)}
                type="button"
              >
                <XIcon className="size-6" />
              </button>
            </p>
          ) : heard && phase !== 'idle' ? (
            <p className="line-clamp-2 text-muted-foreground">“{heard}”</p>
          ) : null}
        </div>
      </section>

      <div className="relative size-[min(76vw,46svh,24rem)] landscape:col-start-1 landscape:row-span-2 landscape:row-start-1 landscape:size-[min(40vw,62svh,22rem)]">
        {stream && <LevelHalo stream={stream} />}
        <button
          aria-label={tap}
          className={cn(
            'relative grid size-full place-items-center rounded-full border-4 transition-colors duration-200',
            phase === 'listening'
              ? 'border-error bg-error text-background'
              : phase === 'speaking'
                ? 'border-brand/60 bg-muted/40 text-foreground active:bg-muted'
                : 'border-border bg-muted/40 text-foreground active:bg-muted',
            phase === 'transcribing' && 'text-muted-foreground',
          )}
          disabled={transcribing}
          onClick={() => void talk()}
          type="button"
        >
          <span className="flex flex-col items-center gap-2">
            {phase === 'listening' ? (
              <SendIcon className="size-20" />
            ) : phase === 'transcribing' ? (
              <LoaderCircleIcon className="size-20 motion-safe:animate-spin" />
            ) : (
              <MicIcon className="size-20" />
            )}
            {phase !== 'transcribing' && <span className="text-2xl font-semibold">{tap}</span>}
          </span>
        </button>
      </div>

      <nav className="flex w-full max-w-md flex-col gap-3 landscape:col-start-2 landscape:row-start-2 landscape:self-start">
        {locked && (
          <button
            className="flex h-16 items-center justify-center gap-3 rounded-2xl bg-brand/20 text-xl font-medium text-brand active:bg-brand/30"
            onClick={() => void replay()}
            type="button"
          >
            <Volume2Icon className="size-7" /> Tap to hear it
          </button>
        )}
        <div className="flex gap-3">
          <button
            className="flex h-20 flex-1 items-center justify-center gap-3 rounded-2xl bg-muted/60 text-xl font-medium active:bg-muted disabled:opacity-30 landscape:h-16"
            disabled={!last || recording}
            onClick={() => void replay()}
            type="button"
          >
            <RotateCcwIcon className="size-7" /> Replay
          </button>
          <button
            className="flex h-20 flex-1 items-center justify-center gap-3 rounded-2xl bg-muted/60 text-xl font-medium active:bg-muted disabled:opacity-30 landscape:h-16"
            disabled={!speaking}
            onClick={() => player.current!.stop()}
            type="button"
          >
            <SquareIcon className="size-6 fill-current" /> Stop
          </button>
        </div>
      </nav>
    </main>
  )
}

/** In @ultimate: what the user said on the Drive screen, as their turn, without the speaking instruction. */
function SpokenRow({ entry }: { entry: EntryRecord }) {
  const message = entry.model?.[0]
  if (message?.role !== 'user') return null
  return (
    <div data-drive-spoken>
      <UserView entry={entry} message={message} text={(entry.data as { text: string }).text} />
      <p className="-mt-3 flex items-center justify-end gap-1 font-mono text-[11px] text-muted-foreground">
        <CarFrontIcon className="size-3" /> spoken
      </p>
    </div>
  )
}

export default defineWebExtension({
  entries: { 'drive.spoken': SpokenRow },
  // In @ultimate's compact transcript a spoken turn is the user's turn, as a typed one is, never folded away.
  compact: {
    when: (conversation, docs) =>
      (docs[StandingDoc.kind] as Record<string, number> | null | undefined)?.ultimate ===
      conversation.id,
    docs: [StandingDoc.kind],
    thread: ({ entry }) => entry.kind === 'drive.spoken',
  },
  surfaces: [
    {
      id: 'drive',
      title: 'Drive',
      icon: CarFrontIcon,
      description: 'Talk to @ultimate by voice; it answers aloud',
      order: 50,
      component: Drive,
    },
  ],
})
