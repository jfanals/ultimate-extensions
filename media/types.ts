/** Browser-safe: what the server facet serves and the link renderer spots. */

/** The media types played, by file extension.  */
export const TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}

/** Whether an href is an absolute path to a narrated deck's manifest. */
export function isDeck(href: string) {
  return href.startsWith('/') && !href.startsWith('//') && href.endsWith('/deck.json')
}

/** The media type of an href that is an absolute path to a media file, else undefined. */
export function mediaType(href: string) {
  if (!href.startsWith('/') || href.startsWith('//')) return undefined
  return TYPES[/\.[^./]+$/.exec(href)?.[0].toLowerCase() ?? '']
}

/** The text files the viewer opens, by extension: notes, data, logs and source code; `.env` stays out (secrets). */
const TEXT = new Set(
  (
    'md markdown mdx txt text rst adoc org json jsonc json5 jsonl ndjson yaml yml toml csv tsv log ini cfg conf ' +
    'properties xml plist html htm css scss sass less svg vtt srt diff patch sql graphql gql proto ' +
    'ts tsx mts cts js jsx mjs cjs vue svelte astro py rb go rs java kt kts swift m mm c h cc cpp hpp cs fs php ' +
    'lua r dart scala ex exs erl hs ml clj nix tf hcl sh bash zsh fish ps1 bat gradle cmake mk lock'
  )
    .split(' ')
    .map((ext) => `.${ext}`),
)
/** Text files known by name. Other dotfiles (`.npmrc`, `.netrc`) may hold tokens and stay links. */
const TEXT_NAMES = new Set(
  'makefile dockerfile license readme gemfile procfile .gitignore .gitattributes .editorconfig'.split(
    ' ',
  ),
)

/** Whether a path names a text file: a text extension or a known name. */
export function isTextPath(path: string) {
  const name = path.split('/').at(-1)?.toLowerCase() ?? ''
  return TEXT_NAMES.has(name) || TEXT.has(/.\.[^.]+$/.exec(name)?.[0].slice(1) ?? '')
}

/** Whether an href is an absolute path to a text file (Markdown escapes such as %20 still in it). */
export function isText(href: string) {
  return href.startsWith('/') && !href.startsWith('//') && !isDeck(href) && isTextPath(href)
}

/** A `:line` or `:line:column` after a path, as compilers and agents write `src/app.ts:42`. */
const LINE = /:\d+(?::\d+)?$/
/** Characters no path an agent mentions has, but commands, globs and prose do. */
const NOT_PATH = /[\s*?<>|$&;'"`(){}[\]\\!=,#]/

/**
 * Whether an inline code span looks like a path to a text file (`src/app.ts`, `~/notes.md`, `README.md:12`): a text
 * extension or name, no spaces or shell syntax, not a URL or an option. The cheap test before asking the server.
 */
export function isPathCandidate(code: string) {
  const path = code.replace(LINE, '')
  return (
    path.length > 0 &&
    path.length <= 300 &&
    !NOT_PATH.test(path) &&
    !/^[a-z][a-z\d+.-]*:/i.test(path) && // https:, mailto:, file:
    !path.startsWith('//') &&
    !path.startsWith('-') &&
    (!path.startsWith('~') || path.startsWith('~/')) &&
    isTextPath(path)
  )
}

/**
 * The absolute path an inline code span names: absolute as written, `~/…` under `home`, anything else under `cwd`, with
 * `.` and `..` resolved and any `:line` dropped. Undefined when it is not a path candidate.
 */
export function resolvePath(code: string, { cwd, home }: { cwd: string; home: string }) {
  if (!isPathCandidate(code)) return undefined
  const path = code.replace(LINE, '')
  return normalize(
    path.startsWith('/')
      ? path
      : path.startsWith('~/')
        ? `${home}/${path.slice(2)}`
        : `${cwd}/${path}`,
  )
}

/**
 * A link target in a Markdown file in `folder`, as the link renderer needs it: a relative path (`../README.md`,
 * `docs/plan.md`) becomes absolute against that folder, without its `#fragment` or `?query`, escapes such as %20 kept;
 * a URL, an absolute path or a `#heading` stays as written.
 */
export function resolveLink(url: string, folder: string) {
  if (!url || /^[/#?]/.test(url) || /^[a-z][a-z\d+.-]*:/i.test(url)) return url
  return normalize(`${encodeURI(folder)}/${url.replace(/[?#].*$/, '')}`)
}

export type Destination = { start: number; end: number; url: string }
type Marked = { url?: string; data?: { destination?: [number, number] }; children?: Marked[] }
type Token = { start: { offset: number }; end: { offset: number } }

/** A remark plugin: each link, image and definition node of the tree it parses carries where its destination is written. */
export function remarkDestinations(this: { data(): unknown }) {
  const mark = function (this: { stack: Marked[] }, token: Token) {
    const node = this.stack.at(-1)
    if (node) node.data = { ...node.data, destination: [token.start.offset, token.end.offset] }
  }
  const data = this.data() as { fromMarkdownExtensions?: unknown[] }
  ;(data.fromMarkdownExtensions ??= []).push({
    exit: { resourceDestination: mark, definitionDestination: mark },
  })
}

/** The destinations of a tree parsed with `remarkDestinations`: where each is written and the URL it means. */
export function destinationsOf(tree: unknown) {
  const found: Destination[] = []
  const walk = (node: Marked) => {
    const at = node.data?.destination
    if (at && node.url !== undefined) found.push({ start: at[0], end: at[1], url: node.url })
    node.children?.forEach(walk)
  }
  walk(tree as Marked)
  return found
}

/**
 * `text`, a Markdown file in `folder`, with each of its `destinations` written as what `resolveLink` makes of it:
 * parsed again, each destination means exactly that URL. Everything else stays as written.
 */
export function resolveDestinations(text: string, destinations: Destination[], folder: string) {
  return destinations
    .toSorted((a, b) => b.start - a.start)
    .reduce((result, { start, end, url }) => {
      const to = resolveLink(url, folder)
      if (to === url) return result
      return `${result.slice(0, start)}<${to.replace(/[\\<>&|]/g, '\\$&')}>${result.slice(end)}`
    }, text)
}

/** An absolute path with `.`, `..` and doubled slashes resolved. */
function normalize(path: string) {
  const parts: string[] = []
  for (const part of path.split('/'))
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  return `/${parts.join('/')}`
}

/** What the viewer shows at first: about 200 KB or 2,000 lines, whichever ends first. */
export const TEXT_BYTES = 200 * 1024
export const TEXT_LINES = 2000
/** The most "Load all" reads; a longer file opens in an editor instead. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024
