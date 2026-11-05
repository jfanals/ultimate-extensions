/** A project's tile: two initials on a colour from its name. Pure and browser-safe. */

/** One project's entry in the `projectIcon` setting; both fields optional. */
export type Override = { color?: string; text?: string }
/** The `projectIcon` setting: overrides keyed by project name. */
export type Overrides = Record<string, Override>

/** The setting's valid entries: an object per name, keeping only string `color` and `text`. */
export function overrides(value: unknown): Overrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, entry]) => {
      if (!entry || typeof entry !== 'object') return []
      const { color, text } = entry as Record<string, unknown>
      return [
        [
          name,
          {
            ...(typeof color === 'string' ? { color } : {}),
            ...(typeof text === 'string' ? { text } : {}),
          },
        ],
      ]
    }),
  )
}

/**
 * The project's name: its folder, or for a branch checkout (`~/.ultimate/projects/<name>-<hash>/worktrees/<id>`) the
 * project's own name, so a preview of a branch wears its project's tile.
 */
export function projectName(root: string) {
  const worktree = /\/\.ultimate\/projects\/(.+)-[\da-f]{8}\/worktrees\/\d+\/?$/.exec(root)
  return worktree?.[1] ?? root.replace(/\/+$/, '').split('/').pop() ?? root
}

/**
 * The first letters of the first two words, split on `-`, `_`, `.`, spaces and camelCase (`RecipeBook` → `RB`); a
 * single word gives its first letter and its second in lower case (`notes` → `No`).
 */
export function initials(name: string) {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_.\s]+/)
    .filter(Boolean)
  if (words.length > 1) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  const word = words[0] ?? '?'
  return word[0]!.toUpperCase() + (word[1] ?? '').toLowerCase()
}

/** Ten hues 36° apart (roughly), so two projects rarely get colours that look alike. */
const PALETTE = [0, 36, 72, 108, 150, 190, 215, 250, 285, 320]
const SATURATION = 0.62
const LIGHTNESS = 0.52
const WHITE = '#ffffff'
const BLACK = '#121216'

/** FNV-1a over the lower-cased name: the same name gives the same hue on every machine. */
function hash(name: string) {
  let h = 2166136261
  for (const c of name.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

const hex = (rgb: readonly number[]) =>
  `#${rgb
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

/** `#rgb` or `#rrggbb` as 0–1 channels; undefined for anything else. */
function parse(color: string): [number, number, number] | undefined {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(color)
  const long = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
  const parts = short?.slice(1).map((c) => c + c) ?? long?.slice(1)
  return parts?.map((part) => parseInt(part, 16) / 255) as [number, number, number] | undefined
}

/** WCAG relative luminance. */
const luminance = (rgb: readonly number[]) =>
  rgb
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0)

/** WCAG contrast ratio of two luminances. */
export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/**
 * The tile's background (the override's `color` when it is a hex colour, else a palette hue from the name) and its
 * ink: white or near-black, whichever contrasts more with it.
 */
export function colours(name: string, override?: Override) {
  const custom = override?.color ? parse(override.color) : undefined
  const rgb = custom ?? hsl(PALETTE[hash(name) % PALETTE.length]!, SATURATION, LIGHTNESS)
  const background = luminance(rgb)
  const white = contrast(background, 1)
  const black = contrast(background, luminance(parse(BLACK)!))
  return {
    background: hex(rgb),
    ink: white >= black ? WHITE : BLACK,
    ratio: Math.max(white, black),
  }
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * The tile as an SVG data URL: a 32×32 rounded square with the initials (or the override's `text`). With `dot`, a
 * status dot sits on the top-right corner in a notch cut out of the tile, so it reads on any tab colour; the letters sit
 * low enough that it leaves the second one whole at 16 px.
 */
export function tile(name: string, options: { dot?: string; override?: Override } = {}) {
  const { background, ink } = colours(name, options.override)
  const text = options.override?.text || initials(name)
  const size = text.length > 2 ? 14 : text.length > 1 ? 18 : 22
  const notch = options.dot
    ? '<mask id="n"><rect width="32" height="32" fill="#fff"/><circle cx="26.5" cy="5.5" r="7.5"/></mask>'
    : ''
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    notch +
    `<g${options.dot ? ' mask="url(#n)"' : ''}>` +
    `<rect width="32" height="32" rx="7" fill="${background}"/>` +
    `<text x="16" y="19" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-weight="800" font-size="${size}" letter-spacing="-0.6" fill="${ink}">${escape(text)}</text>` +
    '</g>' +
    (options.dot ? `<circle cx="26.5" cy="5.5" r="5.5" fill="${options.dot}"/>` : '') +
    '</svg>'
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
