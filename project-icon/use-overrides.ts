/** The `projectIcon` overrides in the browser, for tab-status's favicon and the Fleet rows. */
import { useSyncExternalStore } from 'react'
import { actionRef, api } from '@/sdk'
import type { Overrides } from './icon.ts'

/** No arguments → the `projectIcon` setting (server.ts). */
const OverridesAction = actionRef<null, Overrides>('project-icon', 'overrides')

/** How often a page reads the setting again, so an edit shows without a reload. */
const POLL_MS = 60_000

/** One read per page, shared by every reader; polls while anything reads it. */
const store = (() => {
  let value: Overrides = {}
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  const read = () =>
    api.action(OverridesAction).then(
      (next) => {
        if (JSON.stringify(next) === JSON.stringify(value)) return
        value = next
        for (const listener of listeners) listener()
      },
      // Without project-icon's server facet (or on a failed read) tiles use the colours from their names.
      () => undefined,
    )
  return {
    get: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      if (listeners.size === 1) {
        void read()
        timer = setInterval(() => void read(), POLL_MS)
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) clearInterval(timer)
      }
    },
  }
})()

export const useOverrides = () => useSyncExternalStore(store.subscribe, store.get)
