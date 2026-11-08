import assert from 'node:assert/strict'
import test from 'node:test'
import { pick } from './picker.ts'

const files = [
  {
    name: 'codex-free.json',
    auth_index: 'free',
    provider: 'codex',
    disabled: false,
    id_token: { chatgpt_account_id: 'free-id' },
  },
  {
    name: 'codex-pro.json',
    auth_index: 'pro',
    provider: 'codex',
    disabled: false,
    priority: 10,
    id_token: { chatgpt_account_id: 'pro-id' },
  },
  { name: 'claude-a.json', auth_index: 'a', provider: 'claude', disabled: false },
  { name: 'claude-b.json', auth_index: 'b', provider: 'claude', disabled: false },
  { name: 'claude-disabled.json', auth_index: 'disabled', provider: 'claude', disabled: true },
]
const usage: Record<string, unknown> = {
  free: {
    rate_limit: {
      allowed: true,
      primary_window: { used_percent: 0, limit_window_seconds: 2592000 },
      secondary_window: null,
    },
  },
  pro: {
    rate_limit: {
      allowed: true,
      primary_window: { used_percent: 40, limit_window_seconds: 604800 },
      secondary_window: null,
    },
  },
  a: { seven_day: { utilization: 20 }, five_hour: { utilization: 5 } },
  b: { seven_day: { utilization: 10 }, five_hour: { utilization: 80 } },
}

function proxy(fail?: string) {
  const patches: { path: string; body: any }[] = []
  const current = structuredClone(files)
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url).split('/v0/management/')[1]
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (init?.method === 'PATCH') {
      patches.push({ path, body })
      if (path === 'auth-files/fields')
        Object.assign(
          current.find((account) => account.name === body.name)!,
          { priority: body.priority },
        )
      return Response.json({ status: 'ok' })
    }
    if (path === 'auth-files') return Response.json({ files: current })
    if (path === 'routing/strategy') return Response.json({ strategy: 'fill-first' })
    assert.equal(path, 'api-call')
    assert.equal(body.header.Authorization, 'Bearer $TOKEN$')
    if (body.auth_index === fail)
      return Response.json({ status_code: 401, body: 'private upstream details' })
    assert.ok(usage[body.auth_index], 'disabled accounts must not be probed')
    return Response.json({ status_code: 200, body: JSON.stringify(usage[body.auth_index]) })
  }
  return { fetcher, patches }
}

test('daily picker independently selects least longest-window usage and leaves backups enabled', async () => {
  const { fetcher, patches } = proxy()
  const results = await pick('test-management-key', false, fetcher)
  assert.deepEqual(
    results.map(({ provider, account }) => ({ provider, account })),
    [
      { provider: 'codex', account: 'free' },
      { provider: 'claude', account: 'b' },
    ],
  )
  assert.deepEqual(patches, [
    { path: 'auth-files/fields', body: { name: 'codex-free.json', priority: 10 } },
    { path: 'auth-files/fields', body: { name: 'codex-pro.json', priority: 0 } },
    { path: 'auth-files/fields', body: { name: 'claude-b.json', priority: 10 } },
    { path: 'routing/strategy', body: { value: 'fill-first' } },
  ])
  const dry = proxy()
  assert.deepEqual(await pick('test-management-key', true, dry.fetcher), results)
  assert.deepEqual(dry.patches, [])
})

test('a failed quota read leaves that provider unchanged without leaking the response', async () => {
  const { fetcher, patches } = proxy('pro')
  const results = await pick('test-management-key', false, fetcher)
  assert.equal(results[0].error, 'Upstream quota: HTTP 401; priorities unchanged')
  assert.equal(results[1].account, 'b')
  assert.deepEqual(
    patches.filter(({ path }) => path === 'auth-files/fields'),
    [{ path: 'auth-files/fields', body: { name: 'claude-b.json', priority: 10 } }],
  )
  assert.ok(!JSON.stringify(results).includes('private upstream details'))
})
