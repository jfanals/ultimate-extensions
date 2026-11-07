import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * YouTube's keys for the transcript's players. One player takes them: the full-screen one, else the one last played
 * or clicked while at least half of it is on screen. A key a player does not handle keeps its default (Space scrolls).
 */
type Player = { root: HTMLElement; key: (key: string) => boolean }

const players = new Set<Player>()
const onScreen = new WeakSet<Element>()
let active: Player | undefined
let observer: IntersectionObserver | undefined

/** Controls that use these keys themselves, outside a player. */
const OWN_KEYS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="listbox"], [role="menu"], [role="tablist"], [role="radiogroup"], [role="grid"], [role="tree"]'

function chosen() {
  const full = document.fullscreenElement
  if (full) return [...players].find((player) => player.root.contains(full))
  return active && onScreen.has(active.root) ? active : undefined
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  const player = chosen()
  if (!player) return
  const target = event.target instanceof Element ? event.target : null
  // In full screen nothing else shows, so the focus left behind (often the composer) keeps no keys.
  const inside = !!document.fullscreenElement || (!!target && player.root.contains(target))
  if (!inside && target?.closest(OWN_KEYS)) return
  // Space on a focused button or link elsewhere presses it.
  if (!inside && event.key === ' ' && target?.closest('button, a, summary')) return
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  // A question card on the page answers with letters (extensions/questions): leave them to it unless full screen.
  if (
    /^[a-z]$/.test(key) &&
    !document.fullscreenElement &&
    document.querySelector('[data-questions-card]')
  )
    return
  if (player.key(key)) event.preventDefault()
}

/**
 * Makes the element it is the ref of a player that takes the keys: `handle` gets each key (`' '`, `'ArrowLeft'`,
 * lowercase letters) and answers whether it acted on it.
 */
export function usePlayerKeys(handle: (key: string) => boolean) {
  const latest = useRef(handle)
  useEffect(() => {
    latest.current = handle
  })
  return useCallback((root: HTMLElement | null) => {
    if (!root) return undefined
    const player: Player = { root, key: (key) => latest.current(key) }
    if (!players.size) window.addEventListener('keydown', onKeyDown)
    players.add(player)
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.intersectionRatio >= 0.5) onScreen.add(entry.target)
          else onScreen.delete(entry.target)
      },
      { threshold: [0, 0.5, 1] },
    )
    observer.observe(root)
    const take = () => (active = player)
    root.addEventListener('pointerdown', take)
    // `play` does not bubble; capturing it here sees every audio or video inside.
    root.addEventListener('play', take, true)
    return () => {
      root.removeEventListener('pointerdown', take)
      root.removeEventListener('play', take, true)
      observer?.unobserve(root)
      players.delete(player)
      if (active === player) active = undefined
      if (!players.size) window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}

const CAPTIONS = 'media.captions'

/** Whether captions show, remembered for every player; on until the user turns them off. */
export function useCaptions() {
  const [on, setOn] = useState(() => localStorage.getItem(CAPTIONS) !== 'off')
  const set = (next: boolean) => {
    localStorage.setItem(CAPTIONS, next ? 'on' : 'off')
    setOn(next)
  }
  return [on, set] as const
}

/** Full screen for `element`, or out of it when anything is full screen. */
export function toggleFullscreen(element: Element | null | undefined) {
  // A refusal (no user gesture, an iframe without permission) leaves the page as it was; there is nothing to undo.
  const ignore = () => undefined
  if (document.fullscreenElement) document.exitFullscreen().catch(ignore)
  else element?.requestFullscreen().catch(ignore)
}
