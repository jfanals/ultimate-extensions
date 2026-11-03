/**
 * The hold and release rule, without timers or processes: `tick(busy, now)` holds one sleep assertion while any agent
 * works and releases it `grace` ms after the last one went idle; `close()` releases at once.
 */

/** A running `caffeinate`: `stop` kills it and resolves once it exited. */
export type Hold = { stop(): Promise<void> }

/** Starts a hold; it calls `gone` if the process exits or fails on its own. */
export type Spawn = (gone: () => void) => Hold

export type Awake = {
  /** Feed the number of working conversations at `now`; starts or ends the hold. */
  tick(busy: number, now: number): void
  /** Release now and wait for the process to exit: facet unload or reinstall. */
  close(): Promise<void>
  readonly held: boolean
  readonly busy: number
}

export function createAwake(spawn: Spawn, grace: number): Awake {
  let hold: Hold | undefined
  let idleSince: number | undefined
  let busy = 0
  /** The last stop, so `close` also waits for an idle release still exiting. */
  let stopping = Promise.resolve()
  const release = () => {
    if (hold) stopping = hold.stop()
    hold = undefined
    idleSince = undefined
    return stopping
  }
  return {
    tick(count, now) {
      busy = count
      if (count > 0) {
        idleSince = undefined
        if (!hold) {
          const next: Hold = spawn(() => {
            // A dead process no longer holds; the next busy tick starts a fresh one.
            if (hold === next) hold = undefined
          })
          hold = next
        }
        return
      }
      if (!hold) return
      idleSince ??= now
      // oxlint-disable-next-line typescript/no-floating-promises -- an idle release need not wait for the exit.
      if (now - idleSince >= grace) void release()
    },
    close: release,
    get held() {
      return hold !== undefined
    },
    get busy() {
      return busy
    },
  }
}

/** `pmset -g batt` output → whether the Mac draws from AC power. */
export const onAC = (batt: string) => batt.includes("'AC Power'")
