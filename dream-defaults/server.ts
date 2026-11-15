/**
 * Dream defaults: the user's thresholds for dream's two built-in automations, once per chapter (README, `defaults.ts`).
 * What it set or left goes into the chapter's folder, so a later edit, pause or deletion by the user stays.
 */
import { join } from 'node:path'
import { defineExtension } from '@earendil-works/pi-durable'
// Ultimate's own modules, from the clone (`@` is its web/src).
import { onCommit } from '@/../../lib/commits.ts'
import { readJson, writeJson } from '@/../../lib/json-file.ts'
import { readSettings, userSettingsPath } from '@/../../lib/settings.ts'
import type { ExtensionHost } from '@/../../server/extensions.ts'
import type { AutomationListItem } from '@/../../extensions/automations/refs.ts'
import { BUILT_INS, decide, defaultsOf, DREAM_DOCS } from './defaults.ts'

/** The settings names of the built-ins handled in this chapter. */
type Done = { done: string[] }

export default function dreamDefaults(host: ExtensionHost) {
  // One check at a time, across facet reloads: two at once could both update.
  const queue = host.resource('dream-defaults.queue', () => ({ last: Promise.resolve() }))
  /** The current opening's watcher; a check from an earlier opening never touches it. */
  let opening: { stop?: () => void } | undefined

  /** Apply the defaults to the built-ins dream has made; true once nothing is left to wait for. */
  async function check(): Promise<boolean> {
    if (!host.extensions().some((item) => item.name === 'automations' && item.enabled)) return true
    const defaults = defaultsOf((await readSettings(userSettingsPath(host.userHome))).dreamDefaults)
    if (!defaults) return true
    const { dir } = host.chapter
    const file = join(dir, 'dream-defaults.json')
    const { done } = await readJson<Done>(file, { done: [] })
    const todo = BUILT_INS.filter((builtIn) => !done.includes(builtIn.setting))
    if (!todo.length) return true
    const signal = new AbortController().signal
    const list = (await host.invoke('automations', 'list', null, signal)) as AutomationListItem[]
    const seed = await readJson<Record<string, unknown> | undefined>(
      join(dir, 'seed.json'),
      undefined,
    )
    let waiting = false
    for (const builtIn of todo) {
      const automation = list.find((item) => item.key === builtIn.key)
      const step = decide(builtIn, defaults, automation, seed)
      if (step === 'wait') {
        waiting = true
        continue
      }
      if (typeof step === 'number') {
        const { metric, of } = automation!.condition!
        await host.invoke(
          'automations',
          'update',
          { id: automation!.id, condition: { metric, of, above: step } },
          signal,
        )
      }
      done.push(builtIn.setting)
      await writeJson(file, { done })
    }
    return !waiting
  }

  const run = (mine: { stop?: () => void }) => {
    queue.last = queue.last.then(async () => {
      if (opening !== mine) return
      try {
        if (await check()) mine.stop?.()
      } catch (error) {
        host.notice(`Dream defaults: ${String(error)}`)
      }
    })
  }
  const close = async () => {
    opening?.stop?.()
    opening = undefined
    await queue.last
  }

  host.onOpen(async () => {
    await close()
    const mine: { stop?: () => void } = {}
    opening = mine
    // Dream makes its built-ins after the opening, or once @ultimate starts on a fresh project, and records each id in
    // its own document: a commit to one is the moment to look. Pi's records, not a domain event.
    const detach = onCommit(host.harness(), (publication) => {
      if (
        publication.changes.some(
          (change) => change.type === 'document' && DREAM_DOCS.includes(change.record.kind),
        )
      )
        run(mine)
    })
    mine.stop = () => {
      detach()
      mine.stop = undefined
    }
    run(mine)
  })
  host.onRelease(close)
  host.onClose(close)
  return defineExtension({ name: 'dream-defaults' })
}
