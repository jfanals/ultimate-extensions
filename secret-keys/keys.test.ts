/**
 * Empty keys and `ultimate-secret`, outside the clone's suites: `node --test secret-keys/keys.test.ts`. The dialogs,
 * the tool and the live reload are checked on the running host.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { DEFAULT_DESCRIPTION, keyOf, keysIn, withKey, withoutKey } from './keys.ts'

test('a key takes Ultimate’s secret names and http(s) links, with a description by default', () => {
  assert.deepEqual(keyOf({ name: 'MY_KEY' }), { name: 'MY_KEY', description: DEFAULT_DESCRIPTION })
  assert.deepEqual(keyOf({ name: ' MY_KEY ', description: 'For x', url: 'https://x.dev/keys' }), {
    name: 'MY_KEY',
    description: 'For x',
    url: 'https://x.dev/keys',
  })
  assert.throws(() => keyOf({ name: 'my_key' }), /Capital letters/)
  assert.throws(() => keyOf({ name: '' }), /Give it a name/)
  assert.throws(() => keyOf({ name: 'MY_KEY', url: 'javascript:alert(1)' }), /https/)
})

test('settings keep the valid keys; adding replaces by name, forgetting removes', () => {
  const keys = keysIn({ secretKeys: [{ name: 'A' }, { name: 'bad' }, null, { name: 'B', url: 1 }] })
  assert.deepEqual(keys, [
    { name: 'A', description: DEFAULT_DESCRIPTION },
    { name: 'B', description: DEFAULT_DESCRIPTION },
  ])
  assert.deepEqual(keysIn({}), [])
  const replaced = withKey(keys, { name: 'A', description: 'New' })
  assert.deepEqual(
    replaced.map((key) => key.description),
    ['New', DEFAULT_DESCRIPTION],
  )
  assert.deepEqual(
    withoutKey(replaced, 'A').map((key) => key.name),
    ['B'],
  )
})

test('ultimate-secret prints a stored value without a newline and fails clearly otherwise', async () => {
  const home = await mkdtemp(join(tmpdir(), 'secret-keys-'))
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, [join(import.meta.dirname, 'ultimate-secret'), ...args], {
      env: { HOME: home },
    }).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: '' }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    )
  try {
    assert.match(
      (await run('MY_KEY')).stderr,
      /MY_KEY is not set; add it in Ultimate's Secrets panel/,
    )
    await mkdir(join(home, '.ultimate'))
    const store = join(home, '.ultimate/secrets.json')
    await writeFile(
      store,
      JSON.stringify({ secrets: { MY_KEY: { value: 'v4lue', updatedAt: '' } } }),
    )
    await chmod(store, 0o600)
    assert.deepEqual(await run('MY_KEY'), { code: 0, stdout: 'v4lue', stderr: '' })
    const missing = await run('OTHER')
    assert.equal(missing.code, 1)
    assert.equal(missing.stdout, '')
    assert.equal((await run('lower')).code, 2)
    await chmod(store, 0o644)
    assert.match((await run('MY_KEY')).stderr, /readable by others/)
  } finally {
    await rm(home, { recursive: true })
  }
})
