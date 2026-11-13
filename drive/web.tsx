import type { EntryRecord } from '@earendil-works/pi-durable'
import {
  BellIcon,
  CarFrontIcon,
  LoaderCircleIcon,
  MicIcon,
  PauseIcon,
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
const StandingDoc = docRef<Record<string, number>>('ultimate.standing-agents')

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

/**
 * Other projects' new questions to the user, read aloud with the project's name, from the fleet extension's overview
 * (nothing without it). Returns the ones still open there, as `project:message`.
 */
function useOtherQuestions(say: (utterance: Utterance) => void) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const speak = useRef(say)
  speak.current = say
  useEffect(() => {
    let seen: Set<string> | undefined
    let gone = false
    const look = async () => {
      // Without the fleet extension there is nothing to hear; a failed poll is asked again next time.
      const overview = await api.action(OverviewAction).catch(() => undefined)
      if (!overview || gone) return
      const waiting = overview.rows
        .filter((row) => !row.current)
        .flatMap((row) =>
          row.waiting.map((w) => ({ ...w, project: row.name, key: `${row.name}:${w.message}` })),
        )
      setOpen(new Set(waiting.map((w) => w.key)))
      // The first look only marks where "new" starts, as in useNews.
      const fresh = seen ? waiting.filter((w) => !seen!.has(w.key)) : []
      seen = new Set([...(seen ?? []), ...waiting.map((w) => w.key)])
      for (const { project, message, text, key } of fresh) {
        const question = await api
          .action(QuestionAction, { project, message })
          // Its full questions could not be read: its gist still says what waits.
          .catch(() => ({ text: `${project} says: ${plain(text)}` }))
        if (gone) return
        speak.current({
          key: `remote:${key}`,
          text: `${question.text} Your reply goes to ${project}.`,
          question: message,
          project,
        })
      }
    }
    // oxlint-disable-next-line typescript/no-floating-promises -- look catches its own failures.
    void look()
    const timer = setInterval(() => {
      // oxlint-disable-next-line typescript/no-floating-promises -- look catches its own failures.
      if (document.visibilityState === 'visible') void look()
    }, OTHERS_MS)
    return () => {
      gone = true
      clearInterval(timer)
    }
  }, [])
  return open
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
/** How long `taking` has recorded, pauses left out. */
const recorded = (taking: Recording) =>
  (taking.pausedAt ?? Date.now()) - taking.began - taking.pausedMs
/** A recording whose sending failed, kept so Try again sends it without speaking again; `text` once transcribed. */
type Failed = { audio: Blob; target?: Target; text?: string }

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

/** How long `taking` has recorded, as m:ss; `warned` adds that a minute is left. */
function Elapsed({ taking, warned }: { taking: Recording; warned: boolean }) {
  useNow(500)
  const seconds = Math.max(0, Math.floor(recorded(taking) / 1000))
  return (
    <span className="tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      {warned && <span className="text-warning"> · 1 min left</span>}
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
  const [paused, setPaused] = useState(false)
  const [warned, setWarned] = useState(false)
  /** News that came while the user spoke, held until they listen or the recording ends. */
  const held = useRef<Utterance[]>([])
  const [heldCount, setHeldCount] = useState(0)
  const [failed, setFailed] = useState<Failed>()
  const [transcribing, setTranscribing] = useState(false)
  const [asked, setAsked] = useState(false)
  const [error, setError] = useState<string>()
  const [heard, setHeard] = useState<string>()
  const [last, setLast] = useState<Utterance>()
  const [locked, setLocked] = useState(false)
  const [question, setQuestion] = useState<Target>()
  const [voice, setVoice] = useState<string>()
  const messages = useDocOf(1, MessagesDoc)?.messages

  // Both engines take seconds to load cold: start them as the screen opens, and keep them warm while it is shown.
  const warm = () => {
    api
      .action(WarmAction)
      .then((warmed) => setVoice(warmed.voice))
      .catch((failure: unknown) => setError(errorMessage(failure)))
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
    const taking = active.current
    // Never spoken over the user: a chime now, the news when they listen or stop.
    if (taking && taking.pausedAt === undefined) {
      held.current.push(utterance)
      setHeldCount(held.current.length)
      player.current!.chime()
    } else if (player.current!.unlocked) play(utterance)
    else {
      waiting.current.push(utterance)
      setLast(utterance)
      setLocked(true)
    }
  }
  useNews(main, say)
  const openElsewhere = useOtherQuestions(say)
  const openQuestion =
    question &&
    (question.project
      ? openElsewhere.has(`${question.project}:${question.re}`)
      : messages?.some((m) => m.id === question.re && m.state === 'delivered' && m.reply))
      ? question
      : undefined
  /** Play the news held while the user spoke. */
  const hear = () => {
    setHeldCount(0)
    for (const utterance of held.current.splice(0)) play(utterance)
  }
  /** After a tap unlocked audio: play everything that waited for it. */
  const drain = () => {
    setLocked(false)
    for (const utterance of waiting.current.splice(0)) play(utterance)
  }

  /** Say a short notice; it is not kept for Replay. */
  const notice = (text: string) => {
    // oxlint-disable-next-line typescript/no-floating-promises -- failures show on screen.
    void player.current!.say(text).catch((failure: unknown) => setError(errorMessage(failure)))
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
  const starting = useRef(false)
  const gone = useRef(false)
  async function start() {
    if (starting.current) return
    starting.current = true
    const target = openQuestion
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
      if (active.current !== taking) return
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
      // oxlint-disable-next-line typescript/no-floating-promises -- send shows its own failures on screen.
      void send(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }), taking.target)
    })
    recorder.start(1000)
    active.current = taking
    setWarned(false)
    setRecording(true)
  }

  function finish(cancel: boolean) {
    const taking = active.current
    if (!taking) return
    active.current = undefined
    taking.cancelled = cancel
    if (taking.recorder.state !== 'inactive') taking.recorder.stop()
    setRecording(false)
    setPaused(false)
    // Sent or dropped, the user is free to hear what came meanwhile.
    if (!gone.current) hear()
  }

  /** Listen first: pause the recording and play the held news; the recording goes on or is sent after. */
  async function listen() {
    await player.current!.unlock()
    const taking = active.current
    if (!taking || taking.pausedAt !== undefined) return
    taking.recorder.pause()
    taking.pausedAt = Date.now()
    setPaused(true)
    hear()
  }
  /** Keep talking: stop the news and record on into the same recording. */
  function resume() {
    const taking = active.current
    if (!taking || taking.pausedAt === undefined) return
    player.current!.stop()
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
  const retry = async () => {
    await player.current!.unlock()
    player.current!.stop()
    if (failed) await send(failed.audio, failed.target, failed.text)
  }

  const phase: Phase = recording
    ? paused
      ? 'paused'
      : 'listening'
    : transcribing
      ? 'transcribing'
      : speaking
        ? 'speaking'
        : asked || busy
          ? 'thinking'
          : 'idle'

  const taking = recording ? active.current : undefined
  const stream = phase === 'listening' ? taking?.stream : undefined
  const asking = openQuestion !== undefined && !recording
  const heldFrom = held.current.at(-1)?.project
  /** One of the big buttons under the talk button. */
  const big =
    'flex h-20 flex-1 items-center justify-center gap-3 rounded-2xl bg-muted/60 text-xl font-medium active:bg-muted disabled:opacity-30 landscape:h-16'

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
            phase === 'paused' && 'text-warning',
            phase === 'speaking' && 'text-brand',
            phase === 'idle' && 'text-muted-foreground',
          )}
        >
          {phase === 'listening' && (
            <span className="size-4 shrink-0 rounded-full bg-error motion-safe:animate-pulse" />
          )}
          {phase === 'speaking' && <Volume2Icon className="size-10 shrink-0" />}
          {phase === 'paused' && <PauseIcon className="size-10 shrink-0 fill-current" />}
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
          ) : taking ? (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <Elapsed taking={taking} warned={warned} />
              {heldCount > 0 && (
                <p className="flex items-center gap-2 text-brand">
                  <BellIcon className="size-5" />
                  {heldCount === 1 ? 'New message' : `${heldCount} new messages`}
                  {heldFrom && ` · ${heldFrom}`}
                </p>
              )}
            </div>
          ) : asking ? (
            <p className="flex items-center gap-1 rounded-full bg-warning/15 py-1 pr-1 pl-4 text-lg whitespace-nowrap text-warning">
              Your answer goes to {openQuestion.project ?? 'the question'}
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
              : phase === 'paused'
                ? 'border-warning bg-warning text-background'
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
            {recording ? (
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
        {failed && !recording && !transcribing && (
          <button
            className="flex h-16 items-center justify-center gap-3 rounded-2xl bg-error/20 text-xl font-medium text-error active:bg-error/30"
            onClick={() => void retry()}
            type="button"
          >
            <RotateCcwIcon className="size-7" /> Try again
          </button>
        )}
        {locked && (
          <button
            className="flex h-16 items-center justify-center gap-3 rounded-2xl bg-brand/20 text-xl font-medium text-brand active:bg-brand/30"
            onClick={() => void replay()}
            type="button"
          >
            <Volume2Icon className="size-7" /> Tap to hear it
          </button>
        )}
        {/* While recording: listen to what came, go on after listening, or drop the recording. */}
        {recording ? (
          <div className="flex gap-3">
            {paused ? (
              <button className={big} onClick={resume} type="button">
                <MicIcon className="size-7" /> Keep talking
              </button>
            ) : heldCount > 0 ? (
              <button
                className={cn(big, 'bg-brand/20 text-brand active:bg-brand/30')}
                onClick={() => void listen()}
                type="button"
              >
                <Volume2Icon className="size-7" /> Listen first
              </button>
            ) : null}
            <button className={big} onClick={discard} type="button">
              <XIcon className="size-7" /> Discard
            </button>
          </div>
        ) : (
          <div className="flex gap-3">
            <button className={big} disabled={!last} onClick={() => void replay()} type="button">
              <RotateCcwIcon className="size-7" /> Replay
            </button>
            <button
              className={big}
              disabled={!speaking}
              onClick={() => player.current!.stop()}
              type="button"
            >
              <SquareIcon className="size-6 fill-current" /> Stop
            </button>
          </div>
        )}
        {/* Underdog Woof's licence asks apps that use it to show this credit. */}
        {voice?.startsWith('woof:') && (
          <p className="text-center text-xs text-muted-foreground/70">Voice by Underdog Woof</p>
        )}
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
