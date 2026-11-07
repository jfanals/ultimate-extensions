import { actionRef, api } from '@/sdk'

/** `{ path }` → `{ type, size }` of a media file in a project folder (server.ts). */
export const InfoAction = actionRef<{ path: string }, { type: string; size: number }>(
  'media',
  'info',
)
/** `{ path, offset }` → `{ type, size, data }`: up to 4 MB of it from `offset`, base64. */
const ReadAction = actionRef<
  { path: string; offset: number },
  { type: string; size: number; data: string }
>('media', 'read')

export const MAX_BYTES = 150 * 1024 * 1024

/** The file at `path` as a Blob URL, read chunk by chunk; `progress` gets the bytes read so far. */
export async function load(path: string, progress: (bytes: number) => void, signal: AbortSignal) {
  const parts: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  let size = Infinity
  let type = ''
  while (offset < size) {
    const chunk = await api.action(ReadAction, { path, offset }, { signal })
    const bytes = Uint8Array.from(atob(chunk.data), (c) => c.charCodeAt(0))
    // A file that shrank while it was read ends here rather than looping.
    if (!bytes.length) break
    parts.push(bytes)
    ;({ size, type } = chunk)
    offset += bytes.length
    progress(offset)
  }
  return URL.createObjectURL(new Blob(parts, { type }))
}
