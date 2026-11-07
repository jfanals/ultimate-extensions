/**
 * What `media` serves, outside the clone's suites: `node --test ~/.ultimate/extensions/media/media.test.ts`. The player
 * card is checked on the running host.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CHUNK_BYTES, readChunk, resolveMedia, rootsOf } from './media.ts'
import { mediaType } from './types.ts'

const wav = (bytes: number) => {
  const data = Buffer.alloc(bytes)
  data.write('RIFF', 0, 'latin1')
  data.write('WAVE', 8, 'latin1')
  return data
}

test('serves media in project folders and nothing else', async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'media-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const project = join(base, 'my-app')
  const home = join(base, 'home')
  await mkdir(join(project, 'out'), { recursive: true })
  await mkdir(home)
  await writeFile(join(project, 'out', 'take.wav'), wav(CHUNK_BYTES + 10))
  await writeFile(join(project, 'notes.wav'), 'not audio at all')
  await writeFile(join(project, 'secret.txt'), 'token')
  await writeFile(join(base, 'outside.wav'), wav(64))
  await symlink(join(base, 'outside.wav'), join(project, 'link.wav'))
  await symlink(join(project, 'secret.txt'), join(project, 'secret.wav'))
  const roots = await rootsOf([{ root: project, home }])
  assert.deepEqual(roots, [project])

  const media = await resolveMedia(join(project, 'out', 'take.wav'), roots)
  assert.equal(media.type, 'audio/wav')
  const first = await readChunk(media, 0)
  const rest = await readChunk(media, first.length)
  assert.equal(first.length, CHUNK_BYTES)
  assert.equal(rest.length, 10)

  const refused = async (path: string, reason: RegExp) =>
    assert.rejects(resolveMedia(path, roots), reason)
  await refused(join(project, 'secret.txt'), /Not an audio or video file/)
  await refused(join(project, 'notes.wav'), /Not an audio or video file/)
  await refused(join(project, 'secret.wav'), /Not an audio or video file/)
  await refused(join(base, 'outside.wav'), /Outside your project folders/)
  await refused(join(project, 'link.wav'), /Outside your project folders/)
  await refused(join(project, 'out', '..', '..', 'outside.wav'), /Outside your project folders/)
  await refused('out/take.wav', /Not an absolute path/)
  await assert.rejects(readChunk(media, -1), /Invalid offset/)
})

test('spots links to media files by path', () => {
  assert.equal(mediaType('/Users/me/my-app/out/take%203.WAV'), 'audio/wav')
  assert.equal(mediaType('/Users/me/clip.mp4'), 'video/mp4')
  assert.equal(mediaType('https://example.com/a.mp3'), undefined)
  assert.equal(mediaType('//example.com/a.mp3'), undefined)
  assert.equal(mediaType('/Users/me/notes.md'), undefined)
})
