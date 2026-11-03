/**
 * The parts of other extensions' contracts the Drive screen reads, by name: a user extension cannot import the clone's
 * extension files, so these mirror `messages/refs.ts` (`Message`), `watchdog/refs.ts` (`Failure`), `subagents/refs.ts`
 * (`ultimate.standing-agents`), `voice/refs.ts` (`transcribe`) and the `messages`/`subagents` services. Browser-safe.
 */
import type { Context } from '@earendil-works/chord'
import type { ConversationId } from '@earendil-works/pi-durable'

/** One question of a message to the user, as `messageSpeech` reads it. */
export type Question = {
  text: string
  kind: 'choice' | 'multi' | 'confirm' | 'text' | 'scale'
  ref?: string
  options?: { label: string }[]
  scale?: { min: number; max: number }
}

/** A message of the `board` document, as the screen reads it. */
export type Message = {
  id: number
  from: number | 'user' | 'remote'
  to: number | 'user' | 'remote'
  text: string
  reply: boolean
  state: string
  questions?: Question[]
}

/** The `board` document (messages). */
export type Board = { messages: Message[] }

/** The data of a `watchdog.failure` entry. */
export type Failure = { title: string; error: string }

/** The browser that asked an action, as `ActionContext.device` carries it. */
export type Device = unknown

/** `host.need({ name: 'messages' })`: answering an open message as the user. */
export type MessagesService = {
  answer(messageId: number, text: string, ctx: Context, device?: Device): Promise<number>
}

/** `host.need({ name: 'subagents' })`: the standing agents' conversations. */
export type SubagentsService = {
  standing(name: string, ctx: Context): Promise<ConversationId>
}

/** `host.need({ name: 'speech' })`: the speech user extension's Kokoro voice (`SpeechService` in its `server.ts`). */
export type SpeechService = {
  speak(text: string, voice: string): Promise<Buffer>
  warm(engine: 'kokoro' | 'parakeet', voice?: string): Promise<void>
}
