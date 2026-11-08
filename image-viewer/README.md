# Image viewer

A full-size image in a conversation steps to the previous and next image with ← and →, side buttons or a swipe.

## What it does

Clicking any image thumbnail in a transcript (attached images, screenshots, browser and codemode images, forwarded
images) opens this viewer in place of Ultimate's own one, with the same look. While it is open:

- **← / →**, the side buttons, or a swipe on a phone show the previous or next image, in transcript order.
- A quiet `3 / 12` counter shows where you are.
- **Escape** or a click outside closes it, and the transcript is left scrolled to the image you ended on.

While the viewer is open it takes ← and →, so the [media](../media/) players do not seek behind it.

## Limits

The viewer steps through the images the transcript has **mounted**: history the transcript has not paged in yet (scroll
up to load it) and images inside a folded tool call or step list are not included. Ultimate does not unmount rows that
scroll off screen, so everything loaded counts.

## Settings

None.

## Install, update, uninstall

```sh
ln -s ~/ultimate-extensions/image-viewer ~/.ultimate/extensions/image-viewer   # install
git -C ~/ultimate-extensions pull                                              # update
rm ~/.ultimate/extensions/image-viewer                                         # uninstall
```

## How it works

A web facet only (`web.tsx`) in the `overlay` slot. A capture-phase click listener on `window` catches clicks on the
core's thumbnail (`ToolImage`: a `cursor-zoom-in` dialog trigger) inside `[data-ui="transcript"]` before React sees
them, so the core's single-image dialog never opens; it collects the transcript's thumbnails in DOM order and shows
their `<img>` sources in one dialog. It depends on that markup: if Ultimate changes `ToolImage`, clicks fall through to
the core's own viewer.
