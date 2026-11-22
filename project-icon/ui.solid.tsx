/** @jsxImportSource @solidjs/web */
/** Project tiles for other extensions' Solid code: the tile, a root's project name and the `projectIcon` overrides. */
import { actionRef, keepLast, ROOT, useAction } from '@/sdk/solid'
import type { Overrides } from './icon.ts'

export { projectName, tile } from './icon.ts'

/** No arguments → the `projectIcon` setting (server.ts). */
const OverridesAction = actionRef<null, Overrides>('project-icon', 'overrides')

/** How often the server reads the setting again, so an edit shows without a reload. */
const POLL_MS = 60_000

/**
 * The `projectIcon` overrides, one read per page shared by every reader. Without project-icon's server facet, or on a
 * failed read, tiles keep the colours from their names.
 */
export function useOverrides() {
  const read = useAction(OverridesAction, null, {
    conversation: ROOT,
    every: POLL_MS,
    onError: keepLast,
  })
  return (): Overrides => read.data() ?? {}
}
