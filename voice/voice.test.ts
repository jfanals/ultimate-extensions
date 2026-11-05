/**
 * The local transcription path, outside the clone's suites: `node --test voice/voice.test.ts`. Upstream's OpenAI path
 * is tested in the clone; the real Parakeet server is checked on the running host.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { localTranscribe, transcriptionUrl } from './local.ts'

const audio = { audio: Buffer.from('fake audio').toString('base64'), mimeType: 'audio/mp4' }
const never = new AbortController().signal

test('reads voice.transcriptionUrl from user settings, unset when missing or invalid', async () => {
  const userHome = await mkdtemp(join(tmpdir(), 'voice-'))
  try {
    assert.equal(await transcriptionUrl({ userHome }), undefined)
    await mkdir(join(userHome, '.ultimate'))
    await writeFile(join(userHome, '.ultimate/settings.json'), '{ not json')
    assert.equal(await transcriptionUrl({ userHome }), undefined)
    const url = 'http://127.0.0.1:8179/v1/audio/transcriptions'
    await writeFile(
      join(userHome, '.ultimate/settings.json'),
      JSON.stringify({ voice: { transcriptionUrl: url } }),
    )
    assert.equal(await transcriptionUrl({ userHome }), url)
  } finally {
    await rm(userHome, { recursive: true })
  }
})

test('posts the recording to the local server without a key and names it when it fails', async () => {
  const seen: { authorization?: string; file?: string }[] = []
  let status = 200
  const server = createServer(async (request, response) => {
    const form = await new Request('http://local', {
      method: 'POST',
      headers: request.headers as Record<string, string>,
      body: request as unknown as ReadableStream,
      duplex: 'half',
    } as RequestInit).formData()
    const file = form.get('file') as File
    seen.push({ authorization: request.headers.authorization, file: file.name })
    // 0: never answers, so the caller's deadline passes.
    if (status === 0) return
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(status === 200 ? { text: ' Hello local.\n' } : { error: { message: 'boom' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = `http://127.0.0.1:${port}/v1/audio/transcriptions`
  try {
    assert.equal(await localTranscribe(url, audio, 1024, never), 'Hello local.')
    assert.deepEqual(seen, [{ authorization: undefined, file: 'recording.mp4' }])
    status = 500
    await assert.rejects(localTranscribe(url, audio, 1024, never), {
      message: `Transcription by ${url} failed (HTTP 500): boom`,
    })
    await assert.rejects(localTranscribe(url, audio, 4, never), {
      message: 'The recording is too large to transcribe',
    })
    status = 0
    await assert.rejects(localTranscribe(url, audio, 1024, AbortSignal.timeout(50)), {
      message: `Transcription by ${url} timed out: try a shorter recording`,
    })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  await assert.rejects(localTranscribe(url, audio, 1024, never), {
    message: `Transcription server ${url} is not reachable: is it running?`,
  })
})
