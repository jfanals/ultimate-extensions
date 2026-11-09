import { spawn } from 'node:child_process'
import { defineExtension, section } from '@earendil-works/pi-durable'
import {
  existingText,
  readCaptions,
  readChunk,
  readDeck,
  readText,
  resolveMedia,
  resolveText,
  rootsOf,
} from './media.ts'
import { isTextPath } from './types.ts'

/** The parts of `ExtensionHost` (`server/extensions.ts`) this facet uses. */
type Host = { projects(): Promise<{ root?: string; home: string }[]> }
type Ctx = { host: Host }

export default defineExtension({
  name: 'media',
  sections: [
    section(
      'media',
      () =>
        'To show the user an audio or video file, link its absolute path in Markdown: `[take 3](/Users/me/my-app/out/take-3.wav)`, spaces as %20. The transcript plays it inline. A narrated deck plays the same way: link its `deck.json`. Link a text file you wrote or mention the same way (`[plan](/Users/me/my-app/docs/plan.md)`) and it opens in a viewer. Only files inside a project folder open.',
    ),
  ],
})

const pathArg = (args: unknown) => {
  const { path } = (args && typeof args === 'object' ? args : {}) as { path?: unknown }
  if (typeof path !== 'string') throw new Error('Expected { path }')
  return path
}

/** Starts `editor` on `path`, detached, once it has spawned; rejects when it is not on PATH (as lineage's Open in Zed). */
const launch = (editor: string, path: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [path], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

// Only the transcript's player and viewer read files; an agent has its own tools for that.
export const userActions = ['info', 'read', 'deck', 'captions', 'text', 'edit', 'exists']
export const actions = {
  /**
   * `{ paths }` → the absolute paths among them that name text files in a project folder, the ones the viewer opens:
   * one call checks every inline code path a message mentions. At most 500 are checked.
   */
  exists: async (args: unknown, { host }: Ctx) => {
    const { paths } = (args && typeof args === 'object' ? args : {}) as { paths?: unknown }
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string'))
      throw new Error('Expected { paths }')
    return existingText(paths.slice(0, 500), await rootsOf(await host.projects()))
  },
  /**
   * `{ path }` → `{ type, size }` of a media file in a project folder, or `{ type: 'text', size, lines? }` of a text
   * file, or why it cannot be shown.
   */
  info: async (args: unknown, { host }: Ctx) => {
    const path = pathArg(args)
    const roots = await rootsOf(await host.projects())
    if (isTextPath(path)) {
      const { size, lines } = await resolveText(path, roots)
      return { type: 'text', size, lines }
    }
    const media = await resolveMedia(path, roots)
    return { type: media.type, size: media.size }
  },
  /** `{ path }` → a narrated deck's manifest, its audio and slide images as absolute paths for `read`. */
  deck: async (args: unknown, { host }: Ctx) =>
    readDeck(pathArg(args), await rootsOf(await host.projects())),
  /** `{ path }` → the WebVTT subtitles beside a video in a project folder (`.vtt` or `.srt`), or null. */
  captions: async (args: unknown, { host }: Ctx) =>
    readCaptions(pathArg(args), await rootsOf(await host.projects())),
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
  /**
   * `{ path, all? }` → `{ size, lines?, text, truncated }`: a text file in a project folder as it is on disk now, its
   * first 2,000 lines within 200 KB, or with `all` up to 5 MB.
   */
  text: async (args: unknown, { host }: Ctx) => {
    const { all } = (args && typeof args === 'object' ? args : {}) as { all?: unknown }
    const file = await resolveText(pathArg(args), await rootsOf(await host.projects()))
    return { size: file.size, lines: file.lines, ...(await readText(file, all === true)) }
  },
  /** `{ path }`: open a text file in a project folder in Zed on this machine, `zeditor` (Arch's name) else `zed`. */
  edit: async (args: unknown, { host }: Ctx) => {
    const file = await resolveText(pathArg(args), await rootsOf(await host.projects()))
    for (const editor of ['zeditor', 'zed'])
      try {
        await launch(editor, file.path)
        return { editor }
      } catch (error) {
        // Not on PATH: try the next name; anything else is a real failure.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    throw new Error('Zed is not installed on this machine (no zeditor or zed on PATH)')
  },
}
