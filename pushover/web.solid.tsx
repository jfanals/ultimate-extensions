/** @jsxImportSource @solidjs/web */
import { createEffect, onSettled } from 'solid-js'
import { actionRef, api, defineWebExtension, useNow, usePageVisible } from '@/sdk/solid'

const PresentAction = actionRef<null, null>('pushover', 'present')

/** How often a page in use says so; the server counts a report from the last 60 s as the user being here. */
const BEAT_MS = 15_000
/** Input this recent makes a visible, focused page count as in use. */
const IDLE_MS = 60_000

const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

/** Renders nothing: while this page is visible, focused and touched in the last minute, tells the server so. */
function Presence() {
  const tick = useNow(BEAT_MS, usePageVisible())
  let input = Date.now()
  let reported = 0
  const beat = () => {
    const now = Date.now()
    if (document.visibilityState !== 'visible' || !document.hasFocus() || now - input > IDLE_MS)
      return
    if (now - reported < BEAT_MS) return
    reported = now
    api
      .action(PresentAction, null)
      // A missed beat costs at most one notification while the user is here; the next beat corrects it.
      .catch((error: unknown) => console.warn('Pushover presence', error))
  }
  const touched = () => {
    input = Date.now()
    beat()
  }
  onSettled(() => {
    for (const name of events) window.addEventListener(name, touched, { passive: true })
    window.addEventListener('focus', touched)
    return () => {
      for (const name of events) window.removeEventListener(name, touched)
      window.removeEventListener('focus', touched)
    }
  })
  createEffect(tick, beat)
  return null
}

export default defineWebExtension({ slots: { overlay: [Presence] } })
