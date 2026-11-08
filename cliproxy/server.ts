import { defineExtension } from '@earendil-works/pi-durable'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pick } from './picker.ts'

export const secrets = [
  {
    name: 'CLIPROXY_MANAGEMENT_KEY',
    description:
      'CLIProxyAPI local management key for daily account selection. Make a long random value and save it here; do not send it in chat.',
    url: 'https://help.router-for.me/management/api',
  },
]

export default function cliproxy() {
  return defineExtension({ name: 'cliproxy' })
}

export const actions = {
  /** `{ dryRun: true }` checks quotas without changing priorities; omit for a manual pick. */
  async pick(
    args: { dryRun?: boolean } | null,
    { host }: { host: { userHome: string; ultimateRoot: string } },
  ) {
    const { readSecret } = await import(
      pathToFileURL(join(host.ultimateRoot, 'lib/secrets.ts')).href
    )
    const key = await readSecret(host.userHome, 'CLIPROXY_MANAGEMENT_KEY')
    return pick(key ?? '', args?.dryRun === true)
  },
}
