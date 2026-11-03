/**
 * Awake: while any agent in this project works, hold one `caffeinate -s` so the Mac does not idle-sleep on AC power.
 * Released two minutes after the last agent goes idle, and at once when this facet unloads.
 */
import { execFile, spawn } from 'node:child_process'
import { defineExtension } from '@earendil-works/pi-durable'
import { createAwake, onAC } from './awake.ts'

/** The parts of `ExtensionHost` (`server/extensions.ts`) this facet uses. */
type Host = {
  conversations(): { busy: boolean }[]
  notice(message: string): void
  onOpen(callback: () => Promise<void>): void
  onClose(cleanup: () => Promise<void>): void
}

const GRACE = 2 * 60_000
const TICK = 5_000
const POWER = 60_000

/** Facet-scoped, so a reinstall closes the old one before the new one starts. */
let current: { held: boolean; busy: number; ac: boolean } = { held: false, busy: 0, ac: false }

export default function awake(host: Host) {
  if (process.platform !== 'darwin') return defineExtension({ name: 'awake' })
  // `-s`: prevent system sleep, valid only on AC power; `-w`: ends with this server.
  const state = createAwake((gone) => {
    const child = spawn('caffeinate', ['-s', '-w', String(process.pid)], { stdio: 'ignore' })
    const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
    child.once('error', (error) => host.notice(`Awake: ${error.message}`))
    // oxlint-disable-next-line typescript/no-floating-promises -- `exited` never rejects.
    void exited.then(gone)
    return {
      stop: () => {
        child.kill()
        return exited
      },
    }
  }, GRACE)
  let ac = false
  const power = () =>
    execFile('pmset', ['-g', 'batt'], (error, stdout) => {
      // A failed read keeps the last power source; the next poll reads again.
      if (!error) ac = onAC(stdout)
    })
  const tick = () => {
    state.tick(host.conversations().filter((conversation) => conversation.busy).length, Date.now())
    current = { held: state.held, busy: state.busy, ac }
  }
  let timers: NodeJS.Timeout[] = []
  // The host runs openers after the previous facet's cleanup, so a reinstall never overlaps two holds.
  host.onOpen(async () => {
    if (timers.length) return
    power()
    tick()
    timers = [setInterval(tick, TICK), setInterval(power, POWER)]
  })
  host.onClose(async () => {
    for (const timer of timers) clearInterval(timer)
    timers = []
    await state.close()
    current = { held: false, busy: 0, ac }
  })
  return defineExtension({ name: 'awake' })
}

/** The chip polls it. */
export const pollActions = ['state']

export const actions = {
  /** No arguments → whether the hold is on, how many conversations work and whether the Mac is on AC. */
  state: () => current,
}
