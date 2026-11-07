import { defineExtension, section } from '@earendil-works/pi-durable'
import { readChunk, resolveMedia, rootsOf } from './media.ts'

/** The parts of `ExtensionHost` (`server/extensions.ts`) this facet uses. */
type Host = { projects(): Promise<{ root?: string; home: string }[]> }
type Ctx = { host: Host }

export default defineExtension({
  name: 'media',
  sections: [
    section(
      'media',
      () =>
        'To show the user an audio or video file, link its absolute path in Markdown: `[take 3](/Users/me/my-app/out/take-3.wav)`, spaces as %20. The transcript plays it inline. Only files inside a project folder play.',
    ),
  ],
})

// Only the transcript's player reads files; an agent has its own tools for that.
export const userActions = ['info', 'read']
export const actions = {
  /** `{ path }` → `{ type, size }` of a media file in a project folder, or why it cannot be played. */
  info: async (args: unknown, { host }: Ctx) => {
    const { path } = (args && typeof args === 'object' ? args : {}) as { path?: unknown }
    if (typeof path !== 'string') throw new Error('Expected { path }')
    const media = await resolveMedia(path, await rootsOf(await host.projects()))
    return { type: media.type, size: media.size }
  },
  /** `{ path, offset }` → `{ type, size, data }`: up to 4 MB of a media file in a project folder, as base64. */
  read: async (args: unknown, { host }: Ctx) => {
    const { path, offset } = (args && typeof args === 'object' ? args : {}) as {
      path?: unknown
      offset?: unknown
    }
    if (typeof path !== 'string' || typeof offset !== 'number')
      throw new Error('Expected { path, offset }')
    const media = await resolveMedia(path, await rootsOf(await host.projects()))
    const bytes = await readChunk(media, offset)
    return { type: media.type, size: media.size, data: bytes.toString('base64') }
  },
}
