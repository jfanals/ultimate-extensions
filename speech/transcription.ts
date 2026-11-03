import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** voice's `MAX_AUDIO_BYTES` plus room for the form around it. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024
export const ROUTE = '/v1/audio/transcriptions'
/** `POST` here loads the speech-to-text model without audio, in whichever process serves the port. */
export const WARM_ROUTE = '/v1/speech/warm'

const error = (status: number, message: string) => Response.json({ error: { message } }, { status })

/**
 * OpenAI's transcription endpoint as voice's `openaiTranscribe` calls it: a multipart form with `file`, answered with
 * `{ text }`. The audio goes to `transcribe` as a temporary file, since the worker hands it to ffmpeg by path.
 * `WARM_ROUTE` calls `transcribe('')`, which only loads the model.
 */
export async function handleTranscription(
  request: Request,
  transcribe: (path: string) => Promise<string>,
): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname !== ROUTE && pathname !== WARM_ROUTE) return error(404, 'Not found')
  if (request.method !== 'POST') return error(405, 'Use POST')
  if (pathname === WARM_ROUTE) {
    try {
      await transcribe('')
      return Response.json({})
    } catch (failure) {
      return error(500, failure instanceof Error ? failure.message : String(failure))
    }
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES)
    return error(413, 'The recording is too large')
  let file: FormDataEntryValue | null
  try {
    file = (await request.formData()).get('file')
  } catch {
    // Not a multipart form: the caller sent something else.
    return error(400, 'Expected a multipart form with a file')
  }
  if (!(file instanceof Blob) || !file.size)
    return error(400, 'Expected a multipart form with a file')
  const name = file instanceof File ? file.name : ''
  const extension = /\.(\w{1,5})$/.exec(name)?.[1] ?? 'webm'
  const path = join(tmpdir(), `speech-${randomUUID()}.${extension}`)
  await writeFile(path, Buffer.from(await file.arrayBuffer()))
  try {
    return Response.json({ text: await transcribe(path) })
  } catch (failure) {
    return error(500, failure instanceof Error ? failure.message : String(failure))
  } finally {
    await rm(path, { force: true })
  }
}
