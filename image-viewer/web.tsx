import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { defineWebExtension } from '@/sdk'

/** The core's image thumbnail (`ToolImage` in web/src/components/ai/tool.tsx): a dialog trigger that zooms in. */
const THUMBNAIL = 'button[data-slot="dialog-trigger"].cursor-zoom-in'

type Gallery = { thumbnails: HTMLButtonElement[]; index: number }

/** The thumbnails mounted in `transcript`, in transcript order. */
const thumbnailsIn = (transcript: Element) =>
  [...transcript.querySelectorAll<HTMLButtonElement>(THUMBNAIL)].filter((button) =>
    button.querySelector('img'),
  )

/**
 * Takes over the core's full-size image dialog for thumbnails in a transcript: one viewer that steps through every image
 * the transcript has mounted with ← and →, side buttons or a swipe.
 */
function ImageViewer() {
  const [gallery, setGallery] = useState<Gallery>()
  const touch = useRef<{ x: number; y: number }>(undefined)

  // Capture phase on window runs before React's handler at the root, so the core's own dialog never opens.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest(THUMBNAIL) : null
      const transcript = button?.closest('[data-ui="transcript"]')
      if (!(button instanceof HTMLButtonElement) || !transcript) return
      const thumbnails = thumbnailsIn(transcript)
      const index = thumbnails.indexOf(button)
      if (index < 0) return
      event.preventDefault()
      event.stopPropagation()
      setGallery({ thumbnails, index })
    }
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [])

  const step = (by: number) =>
    setGallery((open) => {
      if (!open) return open
      const index = open.index + by
      return index < 0 || index >= open.thumbnails.length ? open : { ...open, index }
    })

  // While open the viewer owns ← and →: claiming them first keeps the media players' keys (media/keys.ts) from seeking.
  useEffect(() => {
    if (!gallery) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      event.stopPropagation()
      step(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [gallery !== undefined])

  const current = gallery?.thumbnails[gallery.index]
  const image = current?.querySelector('img')
  const count = gallery?.thumbnails.length ?? 0
  const index = gallery?.index ?? 0
  const side =
    'absolute top-1/2 -translate-y-1/2 flex size-9 items-center justify-center rounded-full border border-border/80 bg-terminal/80 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0'

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open || !current) return
        // Leave the transcript on the image the viewer ended on.
        current.scrollIntoView({ block: 'center' })
        setGallery(undefined)
      }}
      open={!!gallery}
    >
      <DialogContent
        className="w-auto max-w-[94vw] border-border/80 bg-terminal p-2 sm:max-w-[94vw]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          current?.focus({ preventScroll: true })
        }}
        onTouchEnd={(event) => {
          const start = touch.current
          const end = event.changedTouches[0]
          touch.current = undefined
          if (!start || !end) return
          const dx = end.clientX - start.x
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(end.clientY - start.y))
            step(dx < 0 ? 1 : -1)
        }}
        onTouchStart={(event) => {
          const point = event.touches[0]
          touch.current = point && { x: point.clientX, y: point.clientY }
        }}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{image?.alt || 'Image'}</DialogTitle>
        {image && (
          <img
            alt={image.alt}
            className={cn(
              'max-w-[90vw] object-contain',
              count > 1 ? 'max-h-[85vh]' : 'max-h-[88vh]',
            )}
            key={index}
            src={image.src}
          />
        )}
        {count > 1 && (
          <>
            <button
              aria-label="Previous image"
              className={`${side} left-3`}
              disabled={index === 0}
              onClick={() => step(-1)}
              type="button"
            >
              <ChevronLeftIcon className="size-5" />
            </button>
            <button
              aria-label="Next image"
              className={`${side} right-3`}
              disabled={index === count - 1}
              onClick={() => step(1)}
              type="button"
            >
              <ChevronRightIcon className="size-5" />
            </button>
            <div className="-mt-2 text-center font-mono text-[11px] leading-5 text-muted-foreground tabular-nums">
              {index + 1} / {count}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default defineWebExtension({ slots: { overlay: [ImageViewer] } })
