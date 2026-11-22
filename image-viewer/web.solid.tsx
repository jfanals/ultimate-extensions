/** @jsxImportSource @solidjs/web */
import { ChevronLeft, ChevronRight } from '@lucide/solid'
import { createEffect, createSignal, onSettled, Show } from 'solid-js'
import { Button } from '@/components/ui/button.solid.tsx'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.solid.tsx'
import { cn, defineWebExtension } from '@/sdk/solid'

/** The core's image thumbnail (`ToolImage` in web/src/components/ai/tool.solid.tsx): a dialog trigger that zooms in. */
const THUMBNAIL = 'button[data-slot="dialog-trigger"].cursor-zoom-in'

type Gallery = { thumbnails: HTMLButtonElement[]; index: number }

/** The thumbnails mounted in `transcript`, in transcript order. */
const thumbnailsIn = (transcript: Element) =>
  [...transcript.querySelectorAll<HTMLButtonElement>(THUMBNAIL)].filter((button) =>
    button.querySelector('img'),
  )

const side =
  'absolute top-1/2 -translate-y-1/2 flex size-9 items-center justify-center rounded-full border border-border/80 bg-terminal/80 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0 data-disabled:pointer-events-none data-disabled:opacity-0'

/**
 * Takes over the core's full-size image dialog for thumbnails in a transcript: one viewer that steps through every image
 * the transcript has mounted with ← and →, side buttons or a swipe.
 */
function ImageViewer() {
  const [gallery, setGallery] = createSignal<Gallery>()
  const current = () => {
    const open = gallery()
    return open?.thumbnails[open.index]
  }
  const image = () => current()?.querySelector('img') ?? undefined
  const count = () => gallery()?.thumbnails.length ?? 0
  const index = () => gallery()?.index ?? 0
  let touch: { x: number; y: number } | undefined
  let closedOn: HTMLButtonElement | undefined

  // Capture phase on window runs before the thumbnail's own handler, so the core's own dialog never opens.
  onSettled(() => {
    const onClick = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest(THUMBNAIL) : null
      const transcript = button?.closest('[data-ui="transcript"]')
      if (!(button instanceof HTMLButtonElement) || !transcript) return
      const thumbnails = thumbnailsIn(transcript)
      const at = thumbnails.indexOf(button)
      if (at < 0) return
      event.preventDefault()
      event.stopPropagation()
      setGallery({ thumbnails, index: at })
    }
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  })

  const step = (by: number) =>
    setGallery((open) => {
      if (!open) return open
      const next = open.index + by
      return next < 0 || next >= open.thumbnails.length ? open : { ...open, index: next }
    })

  // While open the viewer owns ← and →: claiming them first keeps the media players' keys (media/keys.ts) from seeking.
  createEffect(
    () => gallery() !== undefined,
    (open) => {
      if (!open) return undefined
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        event.stopPropagation()
        step(event.key === 'ArrowLeft' ? -1 : 1)
      }
      window.addEventListener('keydown', onKeyDown, true)
      return () => window.removeEventListener('keydown', onKeyDown, true)
    },
  )

  return (
    <Dialog
      onOpenChange={(open) => {
        const button = current()
        if (open || !button) return
        // Leave the transcript on the image the viewer ended on.
        button.scrollIntoView({ block: 'center' })
        closedOn = button
        setGallery(undefined)
      }}
      open={gallery() !== undefined}
    >
      <DialogContent
        class="w-auto max-w-[94vw] border-border/80 bg-terminal p-2 sm:max-w-[94vw]"
        finalFocus={() => closedOn ?? null}
        onTouchEnd={(event: TouchEvent) => {
          const start = touch
          const end = event.changedTouches[0]
          touch = undefined
          if (!start || !end) return
          const dx = end.clientX - start.x
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(end.clientY - start.y))
            step(dx < 0 ? 1 : -1)
        }}
        onTouchStart={(event: TouchEvent) => {
          const point = event.touches[0]
          touch = point && { x: point.clientX, y: point.clientY }
        }}
        showCloseButton={false}
      >
        <DialogTitle class="sr-only">{image()?.alt || 'Image'}</DialogTitle>
        <Show when={image()} keyed>
          {(shown) => (
            <img
              alt={shown.alt}
              class={cn(
                'max-w-[90vw] object-contain',
                count() > 1 ? 'max-h-[85vh]' : 'max-h-[88vh]',
              )}
              src={shown.src}
            />
          )}
        </Show>
        <Show when={count() > 1}>
          <Button
            aria-label="Previous image"
            class={cn(side, 'left-3')}
            disabled={index() === 0}
            onClick={() => step(-1)}
            size={null}
            variant={null}
          >
            <ChevronLeft class="size-5" />
          </Button>
          <Button
            aria-label="Next image"
            class={cn(side, 'right-3')}
            disabled={index() === count() - 1}
            onClick={() => step(1)}
            size={null}
            variant={null}
          >
            <ChevronRight class="size-5" />
          </Button>
          <div class="-mt-2 text-center font-mono text-[11px] leading-5 text-muted-foreground tabular-nums">
            {index() + 1} / {count()}
          </div>
        </Show>
      </DialogContent>
    </Dialog>
  )
}

export default defineWebExtension({ slots: { overlay: [ImageViewer] } })
