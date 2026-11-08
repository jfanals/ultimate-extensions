import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT as context, withAbortSignal } from '@earendil-works/chord/context'
import { defineExtension } from '@earendil-works/pi-durable'
import type { Device, MessagesService, SpeechService, SubagentsService } from './types.ts'

/** The parts of `ExtensionHost` (`server/extensions.ts`) this facet uses. */
type Host = {
  userHome: string
  need<S>(api: { name: string; service?: S }): S
  harness(): {
    conversation(
      id: number,
      ctx: unknown,
    ): Promise<{ submit(input: unknown, ctx: unknown): Promise<unknown> } | undefined>
  }
}
/** The parts of `ActionContext` (`server/actions.ts`) the actions use. */
type Ctx = { host: Host; signal: AbortSignal; device?: Device }

// Services by name, as `messages/api.ts`, `subagents/api.ts` and the speech user extension define them.
const MessagesApi: { name: 'messages'; service?: MessagesService } = { name: 'messages' }
const SubagentsApi: { name: 'subagents'; service?: SubagentsService } = { name: 'subagents' }
const SpeechApi: { name: 'speech'; service?: SpeechService } = { name: 'speech' }

/** What tells @ultimate a spoken input wants a spoken answer; it goes with each input, never in the system prompt. */
export const SPOKEN = `The user said this aloud on the Drive screen, likely while driving, and will hear your answer read out, not see it. Answer in a few short, plain spoken sentences: no Markdown, lists, tables, code, file paths, links or ids. Lead with the outcome; say anything that waits on them as a short numbered choice they can answer by voice. The transcript may contain mistakes.`

/** `{ text }` as @ultimate receives it from the Drive screen. */
export const spokenContent = (text: string) => `${SPOKEN}\n\nThe user said:\n${text}`

/** `drive.voice` in `~/.ultimate/settings.json`, read at each call. */
async function voiceOf(host: Pick<Host, 'userHome'>): Promise<string> {
  // A missing or invalid settings file (reported where settings load) counts as unset here.
  const value: unknown = await readFile(join(host.userHome, '.ultimate/settings.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))
  const voice = (value as { drive?: { voice?: unknown } } | null)?.drive?.voice
  return typeof voice === 'string' && voice ? voice : 'woof:juno'
}

export default defineExtension({ name: 'drive' })

export const userActions = ['ask']
export const actions = {
  /**
   * Start both speech engines and load their models, or restart their idle clocks when they run: the screen calls it as
   * it opens, on each Talk tap and every minute while shown, so neither starts cold while Drive is in use.
   */
  warm: async (_args: unknown, { host }: Ctx) => {
    const voice = await voiceOf(host)
    const speech = host.need(SpeechApi)
    const engine = voice.startsWith('woof:') ? 'woof' : 'kokoro'
    await Promise.all([speech.warm('parakeet'), speech.warm(engine, voice)])
    return { voice }
  },
  /** `{ text }` → base64 WAV of it in `drive.voice`. */
  speak: async (args: unknown, { host }: Ctx) => {
    const text =
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as { text?: unknown }).text
        : undefined
    if (typeof text !== 'string' || !text.trim() || text.length > 2000)
      throw new Error('Expected { text } of at most 2000 characters')
    const wav = await host.need(SpeechApi).speak(text.trim(), await voiceOf(host))
    return { audio: wav.toString('base64') }
  },
  /**
   * `{ text, re? }`: what the user said, to @ultimate as a spoken input; with `re`, the answer to that open message
   * (a question read aloud), as the user's reply.
   */
  ask: async (args: unknown, { host, signal, device }: Ctx) => {
    const data = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as {
      text?: unknown
      re?: unknown
    }
    const text = typeof data.text === 'string' ? data.text.trim() : ''
    if (!text) throw new Error('Expected { text }')
    if (data.re !== undefined && !(Number.isSafeInteger(data.re) && (data.re as number) > 0))
      throw new Error('Expected re to be a message id')
    const ctx = withAbortSignal(signal, context)
    if (typeof data.re === 'number') {
      await host.need(MessagesApi).answer(data.re, text, ctx, device)
      return { answered: data.re }
    }
    const id = await host.need(SubagentsApi).standing('ultimate', ctx)
    const conversation = (await host.harness().conversation(id, ctx))!
    await conversation.submit(
      {
        type: 'input',
        whenBusy: 'steer',
        entry: { kind: 'drive.spoken', data: { text } },
        content: spokenContent(text),
      },
      ctx,
    )
    return { conversation: id }
  },
}
