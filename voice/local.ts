/** The local transcription path, free of Ultimate imports so `node --test` runs it on its own. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** `voice.transcriptionUrl` in `~/.ultimate/settings.json`, read at each call. */
export async function transcriptionUrl(host: { userHome: string }): Promise<string | undefined> {
  // A missing or invalid settings file (reported where settings load) counts as unset here.
  const value: unknown = await readFile(join(host.userHome, '.ultimate/settings.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))
  const url = (value as { voice?: { transcriptionUrl?: unknown } } | null)?.voice?.transcriptionUrl
  return typeof url === 'string' && url ? url : undefined
}

/**
 * `{ audio, mimeType }` (base64) → the trimmed text from the OpenAI-compatible server at `url`, posted as upstream's
 * `openaiTranscribe` posts to OpenAI, without a key. Fails with a message the composer shows as is.
 */
export async function localTranscribe(
  url: string,
  args: unknown,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const { audio, mimeType } = (args ?? {}) as { audio?: unknown; mimeType?: unknown }
  if (typeof audio !== 'string' || !audio || typeof mimeType !== 'string' || !mimeType)
    throw new Error('Expected { audio: base64, mimeType }')
  const bytes = Buffer.from(audio, 'base64')
  if (bytes.byteLength > maxBytes) throw new Error('The recording is too large to transcribe')
  const form = new FormData()
  const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
  form.set('file', new Blob([bytes], { type: mimeType }), `recording.${extension}`)
  form.set('model', 'gpt-4o-mini-transcribe')
  form.set('response_format', 'json')
  let response: Response
  let body: string
  try {
    response = await fetch(url, { method: 'POST', body: form, signal })
    body = await response.text()
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError')
      throw new Error(`Transcription by ${url} timed out: try a shorter recording`)
    throw new Error(`Transcription server ${url} is not reachable: is it running?`)
  }
  let answer: { text?: unknown; error?: { message?: unknown } } | undefined
  try {
    answer = JSON.parse(body)
  } catch {
    // Not JSON: the server answered with an error page.
    answer = undefined
  }
  if (response.ok && typeof answer?.text === 'string') return answer.text.trim()
  const detail = response.ok ? 'no text in the answer' : answer?.error?.message
  throw new Error(
    `Transcription by ${url} failed (HTTP ${response.status})${typeof detail === 'string' ? `: ${detail}` : ''}`,
  )
}
