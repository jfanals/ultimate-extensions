/**
 * Secret keys: declare a secret before its value exists. Empty keys live as `secretKeys` in `~/.ultimate/settings.json`;
 * `secrets` reads them, and a settings change reinstalls this facet (`reloadOnSettings`), so a new key shows in the
 * Secrets panel and the setup check of every running Ultimate within a second, without a restart. Values stay with
 * Ultimate's secrets extension: nothing here takes, reads or prints one.
 */
import { defineExtension, defineTool, section } from '@earendil-works/pi-durable'
import { obj, opt, str } from '@earendil-works/pi-schema'
import { readSecret } from '@/../../lib/secrets.ts'
import { readSettings, updateSettings, userSettingsPath } from '@/../../lib/settings.ts'
import { keyOf, keysIn, withdrawKey, withKey, withoutKey } from './keys.ts'
import type { Key } from './keys.ts'

type Host = { userHome: string }

/** The empty keys in user settings; an invalid settings file, which Ultimate reports itself, has none. */
const readKeys = (userHome: string) =>
  readSettings(userSettingsPath(userHome)).then(keysIn, () => [])

export const secrets = (host: Host) => readKeys(host.userHome)
/** A settings change runs `secrets` again. */
export const reloadOnSettings = true

/** Change the empty keys in user settings, keeping every other setting. */
const change = (host: Host, modify: (keys: Key[]) => Key[]) =>
  updateSettings(userSettingsPath(host.userHome), (settings) => {
    const keys = modify(keysIn(settings))
    if (keys.length) settings.secretKeys = keys
    else delete settings.secretKeys
  })

/** Whether the user stored a value for `name`; the value itself never leaves this check. */
const isSet = async (host: Host, name: string) =>
  (await readSecret(host.userHome, name)) !== undefined

export default function secretKeys(host: Host) {
  return defineExtension({
    name: 'secret-keys',
    sections: [
      section(
        'secret-keys',
        () =>
          "When something you set up needs an API key, token or password the user has not stored, call request_secret instead of asking for it in chat: the user pastes it in the Secrets panel. Server code reads it with readSecret; shell scripts and configs with `ultimate-secret NAME`, only where its output goes into a variable, a pipe or a config, never into your transcript. Never read, cat or grep files that hold credentials (`~/.zshrc` and other shell startup files, `.env` files, `~/.ssh`, `apiKey` values in Pi's `models.json`) in a way that prints their values: to find where a key is set, print key names only, for example `grep -o '^export [A-Z_]*' ~/.zshrc`.",
      ),
    ],
    tools: [
      defineTool({
        name: 'request_secret',
        description:
          'Ask the user for a secret without it passing through chat: adds NAME to their Secrets panel as missing, with your description and where to get it, until they paste the value there. It never takes or returns a value. Tell the user the name and that it waits in ⌘K → Secrets.',
        parameters: obj({
          name: str({ description: 'Uppercase, digits and _: OPENROUTER_API_KEY' }),
          description: str({
            description: 'What it is for, in a sentence the user reads in the panel',
          }),
          url: opt(str({ description: 'Where to get or create the key (http or https)' })),
        }),
        async execute(args) {
          const key = keyOf(args)
          await change(host, (keys) => withKey(keys, key))
          const text = (await isSet(host, key.name))
            ? `${key.name} is already set. Read it with readSecret, or \`ultimate-secret ${key.name}\` in a script, never printing it.`
            : `${key.name} now waits in the Secrets panel. Ask the user to open ⌘K → Secrets and paste its value there, never in chat.`
          return { output: [{ type: 'text', text }] }
        },
      }),
      defineTool({
        name: 'withdraw_secret',
        description:
          'Take back a request_secret that is no longer needed: removes NAME from the Secrets panel while it has no value. Refuses a key with a stored value; only the user deletes values.',
        parameters: obj({ name: str({ description: 'The name passed to request_secret' }) }),
        async execute({ name }) {
          const stored = await isSet(host, name)
          await change(host, (keys) => withdrawKey(keys, name, stored))
          const text = `${name} is withdrawn from the Secrets panel.`
          return { output: [{ type: 'text', text }] }
        },
      }),
    ],
  })
}

/** The New secret… and Forget a secret… dialogs; agents use `request_secret`. */
export const userActions = ['declare', 'forget']

export const actions = {
  /** `{ name, description?, url? }` → the key, now declared. */
  async declare(args: unknown, { host }: { host: Host }) {
    const key = keyOf((args ?? {}) as Record<string, unknown>)
    await change(host, (keys) => withKey(keys, key))
    return key
  },
  /** `{ name }` → the names still declared. A stored value stays; the Secrets panel deletes it. */
  async forget(args: unknown, { host }: { host: Host }) {
    const name = (args as { name?: unknown } | null)?.name
    if (typeof name !== 'string') throw new Error('Expected { name }')
    let left: string[] = []
    await change(host, (keys) => {
      const rest = withoutKey(keys, name)
      left = rest.map((key) => key.name)
      return rest
    })
    return { names: left }
  },
  /** No arguments → the declared empty keys. */
  list: async (_args: unknown, { host }: { host: Host }) => readKeys(host.userHome),
}
