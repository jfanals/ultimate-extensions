/** What the Drive screen reads aloud, as plain sentences: pure helpers, browser-safe. */
import type { EntryRecord } from '@earendil-works/pi-durable'
import type { Failure, Message } from './types.ts'

/** Something to say: `key` keeps it said once; `question` is the open message a spoken answer replies to. */
export type Utterance = { key: string; text: string; question?: number }

/** Markdown as it sounds: no code, links, tables, emphasis or list marks. */
export function plain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(\S[^\n]*?\S|\S)\1/g, '$2')
    .replace(/[ \t]*\n+[ \t]*/g, '. ')
    .replace(/([.!?:;,])\.\s/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `text` in spoken pieces: sentences, short ones joined, so the first plays at once and none waits on a long one. */
export function sentences(text: string, max = 240): string[] {
  const pieces: string[] = []
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    let part = sentence.trim()
    const last = pieces.at(-1)
    if (!part) continue
    if (last !== undefined && last.length + part.length < 80) {
      pieces[pieces.length - 1] = `${last} ${part}`
      continue
    }
    while (part.length > max) {
      const cut = Math.max(part.lastIndexOf(', ', max), part.lastIndexOf(' ', max))
      const at = cut > max / 2 ? cut + 1 : max
      pieces.push(part.slice(0, at).trim())
      part = part.slice(at).trim()
    }
    if (part) pieces.push(part)
  }
  return pieces
}

/** A message to the user as it is read: its text, then its questions with numbered options. */
export function messageSpeech(message: Message, sender?: string): string {
  const said = [sender ? `${sender} says: ${plain(message.text)}` : plain(message.text)]
  for (const [index, question] of (message.questions ?? []).entries()) {
    said.push(`Question ${question.ref ?? index + 1}: ${plain(question.text)}`)
    if (question.kind === 'confirm') said.push('Yes or no?')
    for (const [at, option] of (question.options ?? []).entries())
      said.push(`Option ${at + 1}: ${plain(option.label)}.`)
    if (question.scale) said.push(`From ${question.scale.min} to ${question.scale.max}.`)
  }
  return said.join(' ')
}

/** The text blocks of an assistant entry that ended its turn (no tool call pending), or undefined. */
export function finalAnswer(entry: EntryRecord): string | undefined {
  const message = entry.model?.[0]
  if (entry.kind !== 'pi.assistant' || message?.role !== 'assistant') return undefined
  if (message.stopReason !== 'stop') return undefined
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim()
  return text || undefined
}

/** One of @ultimate's transcript entries the Drive screen reads aloud: final answers, landings, failures. */
export function entrySpeech(entry: EntryRecord): Utterance | undefined {
  const key = `entry:${entry.id}`
  const answer = finalAnswer(entry)
  if (answer) return { key, text: plain(answer) }
  if (entry.kind === 'workspaces.lander-report') {
    const { outcome } = entry.data as {
      outcome: { outcome: string; reason?: string; subject?: { title?: string } }
    }
    const what = outcome.subject?.title ? `"${outcome.subject.title}"` : 'A branch'
    return outcome.outcome === 'failed'
      ? { key, text: `${what} did not land: ${plain(outcome.reason ?? 'it failed')}.` }
      : { key, text: `${what} landed.` }
  }
  if (entry.kind === 'watchdog.failure') {
    const failure = entry.data as Failure
    return { key, text: `${failure.title || 'A branch'} failed: ${plain(failure.error)}` }
  }
  return undefined
}
