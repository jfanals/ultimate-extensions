/**
 * Empty keys: secret names the user or an agent declared before their value exists, kept as `secretKeys` in
 * `~/.ultimate/settings.json`. Browser-safe and free of Ultimate imports, so `node --test` runs it on its own.
 */
export type Key = { name: string; description: string; url?: string }

/** What the Secrets panel shows under an empty key that came without a description. */
export const DEFAULT_DESCRIPTION = 'Added with New secret…'

/** Why `name` cannot be a secret's name, or undefined when it can; the rule is Ultimate's (`lib/secrets.ts`). */
export function nameProblem(name: string): string | undefined {
  if (!name) return 'Give it a name'
  if (!/^[A-Z][A-Z0-9_]*$/.test(name))
    return 'Capital letters, digits and _, starting with a letter: MY_API_KEY'
  return undefined
}

/** Why `url` cannot be a key's link, or undefined when it can be (or is empty). */
export function urlProblem(url: string): string | undefined {
  if (!url) return undefined
  try {
    if (['http:', 'https:'].includes(new URL(url).protocol)) return undefined
  } catch {
    // Not a URL at all: the message below says what is expected.
  }
  return 'A link starting with https://'
}

/** The key as Ultimate's `secrets` declaration expects it, or an error naming the first problem. */
export function keyOf(input: { name?: unknown; description?: unknown; url?: unknown }): Key {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  const problem = nameProblem(name) ?? urlProblem(url)
  if (problem) throw new Error(problem)
  return { name, description: description || DEFAULT_DESCRIPTION, ...(url ? { url } : {}) }
}

/** The empty keys in a settings object; entries Ultimate would reject are skipped, so one bad edit hides only itself. */
export function keysIn(settings: unknown): Key[] {
  const list = (settings as { secretKeys?: unknown } | null)?.secretKeys
  if (!Array.isArray(list)) return []
  return list.flatMap((entry) => {
    try {
      return [keyOf(entry ?? {})]
    } catch {
      return []
    }
  })
}

/** `keys` with `key` added, or replacing the key of the same name in place. */
export function withKey(keys: Key[], key: Key): Key[] {
  return keys.some((entry) => entry.name === key.name)
    ? keys.map((entry) => (entry.name === key.name ? key : entry))
    : [...keys, key]
}

export const withoutKey = (keys: Key[], name: string) => keys.filter((key) => key.name !== name)
