import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineExtension } from '@earendil-works/pi-durable'
import { overrides } from './icon.ts'
import type { Overrides } from './icon.ts'

/** The parts of `ExtensionHost` (`server/extensions.ts`) this facet uses. */
type Host = { userHome: string }
type Ctx = { host: Host }

export default defineExtension({ name: 'project-icon' })

export const pollActions = ['overrides']
export const actions = {
  /** No arguments → `Overrides`: the `projectIcon` setting of `~/.ultimate/settings.json`, invalid entries dropped. */
  overrides: async (_args: unknown, { host }: Ctx): Promise<Overrides> => {
    // A missing or invalid settings file (reported where settings load) counts as no overrides.
    const settings: unknown = await readFile(join(host.userHome, '.ultimate/settings.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => ({}))
    return overrides((settings as { projectIcon?: unknown } | null)?.projectIcon)
  },
}
