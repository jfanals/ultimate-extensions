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
