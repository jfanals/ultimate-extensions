/**
 * What `media` serves, outside the clone's suites: `node --test ~/.ultimate/extensions/media/media.test.ts`. The player
 * card is checked on the running host.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  CHUNK_BYTES,
  existingText,
  readCaptions,
  readChunk,
  readDeck,
  readText,
  resolveMedia,
  resolveText,
  rootsOf,
  unlessMissing,
} from './media.ts'
import {
  isPathCandidate,
  isText,
  MAX_TEXT_BYTES,
  mediaType,
  resolveLink,
  resolvePath,
  TEXT_BYTES,
  TEXT_LINES,
} from './types.ts'

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

test('reads a deck whose files stay in its folder', async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'media-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const folder = join(base, 'talk.deck')
  await mkdir(folder)
  const deck = (cues: unknown[]) =>
    writeFile(
      join(folder, 'deck.json'),
      JSON.stringify({
        title: 'Talk',
        width: 1920,
        height: 1080,
        duration: 3,
        audio: 'narration.m4a',
        cues,
      }),
    )
  await deck([{ scene: 0, text: 'Hi.', image: 'frames/a.jpg', start: 0 }])
  const read = await readDeck(join(folder, 'deck.json'), [base])
  assert.equal(read.audio, join(folder, 'narration.m4a'))
  // A deck without `captions` burned its lines into the slides, so the player adds none.
  assert.equal(read.captions, false)
  assert.equal(read.cues[0]!.image, join(folder, 'frames', 'a.jpg'))

  await deck([{ scene: 0, text: 'Hi.', image: '../../secret.jpg', start: 0 }])
  await assert.rejects(readDeck(join(folder, 'deck.json'), [base]), /Not a deck.json/)
  await assert.rejects(readDeck(join(folder, 'deck.json'), [join(base, 'elsewhere')]), /Outside/)
})

test('gives a video the subtitles beside it as WebVTT', async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'media-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const mp4 = Buffer.alloc(64)
  mp4.write('ftyp', 4, 'latin1')
  await writeFile(join(base, 'talk.mp4'), mp4)
  await writeFile(join(base, 'bare.mp4'), mp4)
  await writeFile(join(base, 'talk.srt'), '1\r\n00:00:00,600 --> 00:00:05,250\r\nHello.\r\n')
  assert.equal(
    await readCaptions(join(base, 'talk.mp4'), [base]),
    'WEBVTT\n\n1\n00:00:00.600 --> 00:00:05.250\nHello.\n',
  )
  assert.equal(await readCaptions(join(base, 'bare.mp4'), [base]), null)
})

test('shows text files in project folders, capped, and nothing binary', async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'media-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  await writeFile(join(base, 'notes.md'), '# Notes\n\nOne.\nTwo')
  await writeFile(join(base, 'Makefile'), 'all:\n')
  await writeFile(join(base, 'fake.ts'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))
  await writeFile(join(base, 'take.wav'), 'RIFF')
  // Many short lines: the line cap ends the first view before the byte cap.
  await writeFile(join(base, 'run.log'), 'ok\n'.repeat(TEXT_LINES * 2))
  // A few long lines: the byte cap ends it, at a line break.
  const line = `${'x'.repeat(999)}\n`
  await writeFile(join(base, 'big.log'), line.repeat(Math.ceil(TEXT_BYTES / 1000) + 100))
  await writeFile(join(base, 'huge.log'), line.repeat(Math.ceil(MAX_TEXT_BYTES / 1000) + 1))
  const roots = [base]

  const notes = await resolveText(join(base, 'notes.md'), roots)
  assert.deepEqual(notes, { path: join(base, 'notes.md'), size: 17, lines: 4 })
  assert.deepEqual(await readText(notes), { text: '# Notes\n\nOne.\nTwo', truncated: false })
  assert.equal((await resolveText(join(base, 'Makefile'), roots)).lines, 1)

  const log = await readText(await resolveText(join(base, 'run.log'), roots))
  assert.equal(log.text, 'ok\n'.repeat(TEXT_LINES))
  assert.equal(log.truncated, true)
  const big = await resolveText(join(base, 'big.log'), roots)
  const first = await readText(big)
  assert.equal(first.text.length, Math.floor(TEXT_BYTES / 1000) * 1000)
  assert.equal(first.truncated, true)
  assert.deepEqual(await readText(big, true), { text: line.repeat(big.lines!), truncated: false })
  const huge = await resolveText(join(base, 'huge.log'), roots)
  assert.equal(huge.lines, undefined)
  const all = await readText(huge, true)
  assert.equal(all.truncated, true)
  assert.ok(all.text.length <= MAX_TEXT_BYTES && all.text.endsWith('\n'))

  await assert.rejects(resolveText(join(base, 'fake.ts'), roots), /Not a text file/)
  await assert.rejects(resolveText(join(base, 'take.wav'), roots), /Not a text file/)
  await assert.rejects(resolveText(join(base, 'gone.md'), roots), /File not found/)
  await assert.rejects(resolveText(join(base, 'notes.md'), [join(base, 'x')]), /Outside/)
})

test('spots links to text files by path', () => {
  assert.equal(isText('/Users/me/my-app/docs/plan%20v2.md'), true)
  assert.equal(isText('/Users/me/my-app/src/app.TS'), true)
  assert.equal(isText('/Users/me/my-app/Dockerfile'), true)
  assert.equal(isText('/Users/me/my-app/.gitignore'), true)
  assert.equal(isText('/Users/me/my-app/.env'), false)
  assert.equal(isText('/Users/me/my-app/.env.local'), false)
  assert.equal(isText('/Users/me/my-app/.npmrc'), false)
  assert.equal(isText('/Users/me/talk.deck/deck.json'), false)
  assert.equal(isText('/Users/me/out/take.wav'), false)
  assert.equal(isText('https://example.com/a.md'), false)
  assert.equal(isText('docs/plan.md'), false)
})

test('spots paths to text files in inline code', () => {
  for (const code of [
    'src/app.ts',
    'README.md',
    'pnpm-lock.yaml',
    './docs/plan.md',
    '../other/notes.txt',
    '~/notes/todo.md',
    '/Users/me/my-app/src/app.tsx',
    'src/app.ts:42',
    'src/app.ts:42:7',
    'node_modules/@scope/pkg/index.d.ts',
    '.github/workflows/ci.yml',
    'Makefile',
  ])
    assert.equal(isPathCandidate(code), true, code)
  for (const code of [
    'pnpm check',
    'git status',
    'https://example.com/a.md',
    'file:///Users/me/a.md',
    '//example.com/a.md',
    'src/*.ts',
    '$HOME/a.md',
    '~other/a.md',
    '--config=app.json',
    'src/app',
    'v1.2.3',
    '.env',
    'config/.env.local',
    '#123',
    '',
  ])
    assert.equal(isPathCandidate(code), false, code)
})

test('resolves inline code paths against the folder and home', () => {
  const where = { cwd: '/Users/me/my-app', home: '/Users/me' }
  assert.equal(resolvePath('src/app.ts', where), '/Users/me/my-app/src/app.ts')
  assert.equal(resolvePath('./docs/../README.md:3', where), '/Users/me/my-app/README.md')
  assert.equal(resolvePath('../other/notes.md', where), '/Users/me/other/notes.md')
  assert.equal(resolvePath('~/notes/todo.md', where), '/Users/me/notes/todo.md')
  assert.equal(resolvePath('/srv/site/index.html', where), '/srv/site/index.html')
  assert.equal(resolvePath('pnpm check', where), undefined)
})

test('opens inline code paths only to text files in project folders', async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'media-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const project = join(base, 'my-app')
  await mkdir(join(project, 'src'), { recursive: true })
  await writeFile(join(project, 'src', 'app.ts'), 'export {}\n')
  await writeFile(join(project, 'README.md'), '# App\n')
  await writeFile(join(project, 'blob.ts'), Buffer.from([0x00, 0x01]))
  await writeFile(join(base, 'outside.md'), '# Not yours\n')
  await symlink(join(base, 'outside.md'), join(project, 'escape.md'))
  const where = { cwd: project, home: base }
  const asked = ['src/app.ts', '~/my-app/README.md', join(project, 'README.md'), 'gone.md']
    .concat(['blob.ts', '../outside.md', '~/outside.md', 'escape.md'])
    .map((code) => resolvePath(code, where)!)
  assert.deepEqual(await existingText(asked, [project]), [
    join(project, 'src', 'app.ts'),
    join(project, 'README.md'),
    join(project, 'README.md'),
  ])
})

test('answers null for a missing file instead of failing', async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'media-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  await writeFile(join(base, 'notes.md'), '# Notes\n')
  assert.equal(await unlessMissing(resolveText(join(base, 'gone.md'), [base])), null)
  assert.equal((await unlessMissing(resolveText(join(base, 'notes.md'), [base])))?.lines, 1)
  await assert.rejects(
    unlessMissing(resolveText(join(base, 'notes.md'), ['/elsewhere'])),
    /Outside/,
  )
})

test('resolves relative links in a viewed Markdown file against its folder', () => {
  const folder = '/Users/me/my-app/docs/extensions'
  assert.equal(
    resolveLink('../../extensions/README.md', folder),
    '/Users/me/my-app/extensions/README.md',
  )
  assert.equal(resolveLink('slots.md#inline', folder), '/Users/me/my-app/docs/extensions/slots.md')
  assert.equal(resolveLink('./a%20b.md', '/Users/me/my notes'), '/Users/me/my%20notes/a%20b.md')
  assert.equal(resolveLink('https://example.com/a.md', folder), 'https://example.com/a.md')
  assert.equal(resolveLink('/Users/me/plan.md', folder), '/Users/me/plan.md')
  assert.equal(resolveLink('#heading', folder), '#heading')
})

test('spots links to media files by path', () => {
  assert.equal(mediaType('/Users/me/my-app/out/take%203.WAV'), 'audio/wav')
  assert.equal(mediaType('/Users/me/clip.mp4'), 'video/mp4')
  assert.equal(mediaType('https://example.com/a.mp3'), undefined)
  assert.equal(mediaType('//example.com/a.mp3'), undefined)
  assert.equal(mediaType('/Users/me/notes.md'), undefined)
})
