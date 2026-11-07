/**
 * What `media` may read and how: audio and video files inside the user's project folders, read in chunks. Node
 * built-ins only, so `node --test` runs it outside the clone.
 */
import { open, realpath, stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import { TYPES } from './types.ts'

/** The largest file the player loads (it plays from memory, so a phone holds all of it). */
export const MAX_BYTES = 150 * 1024 * 1024
/** One `read` call's slice: about 5.3 MB of base64, well inside what a phone fetches at once. */
export const CHUNK_BYTES = 4 * 1024 * 1024

/** A file's first bytes as each container starts, so a renamed non-media file is refused. */
function sniff(head: Buffer) {
  const ascii = (from: number, to: number) => head.toString('latin1', from, to)
  return (
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') ||
    ascii(0, 3) === 'ID3' ||
    (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) || // MPEG audio frame or ADTS AAC
    ascii(0, 4) === 'OggS' ||
    ascii(0, 4) === 'fLaC' ||
    ascii(4, 8) === 'ftyp' || // MP4, M4A, MOV
    ascii(4, 8) === 'moov' ||
    ascii(4, 8) === 'wide' || // older QuickTime
    head.readUInt32BE(0) === 0x1a45dfa3 // Matroska / WebM
  )
}

/** The folders media may come from: each project's folder, and its attachments and worktrees under its home. */
export async function rootsOf(projects: { root?: string; home: string }[]) {
  const folders = projects.flatMap((project) => [
    ...(project.root ? [project.root] : []),
    join(project.home, 'attachments'),
    join(project.home, 'worktrees'),
  ])
  const real = await Promise.all(
    // A folder that does not exist (no attachments yet) holds nothing to serve.
    folders.map((folder) => realpath(folder).catch(() => undefined)),
  )
  return [...new Set(real.filter((folder) => folder !== undefined))]
}

export type Media = { path: string; type: string; size: number }

/**
 * `path` as a playable file: absolute, a media extension, inside one of `roots` once symlinks resolve, a regular file
 * whose bytes look like media. Throws a message the card can show otherwise.
 */
export async function resolveMedia(path: string, roots: string[]): Promise<Media> {
  if (!path.startsWith('/')) throw new Error('Not an absolute path')
  const type = TYPES[extname(path).toLowerCase()]
  if (!type) throw new Error('Not an audio or video file')
  const real = await realpath(path).catch(() => {
    throw new Error('File not found')
  })
  if (!roots.some((root) => real === root || real.startsWith(root + sep)))
    throw new Error('Outside your project folders')
  if (!TYPES[extname(real).toLowerCase()]) throw new Error('Not an audio or video file')
  const info = await stat(real)
  if (!info.isFile()) throw new Error('Not a file')
  const file = await open(real, 'r')
  try {
    const head = Buffer.alloc(12)
    await file.read(head, 0, 12, 0)
    if (!sniff(head)) throw new Error('Not an audio or video file')
  } finally {
    await file.close()
  }
  return { path: real, type, size: info.size }
}

/** Bytes `offset` up to `offset + CHUNK_BYTES` of a resolved file, within the size cap. */
export async function readChunk(media: Media, offset: number) {
  if (media.size > MAX_BYTES) throw new Error('Too large to play here')
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > media.size)
    throw new Error('Invalid offset')
  const length = Math.min(CHUNK_BYTES, media.size - offset)
  const file = await open(media.path, 'r')
  try {
    const bytes = Buffer.alloc(length)
    const { bytesRead } = await file.read(bytes, 0, length, offset)
    return bytes.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}
