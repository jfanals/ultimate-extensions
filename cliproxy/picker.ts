type Provider = 'codex' | 'claude'
type Window = { seconds: number; used: number }
type Account = {
  name: string
  auth_index: string
  provider: Provider
  disabled: boolean
  priority?: number
  id_token?: { chatgpt_account_id?: string }
}
type Candidate = Account & { windows: Window[]; exhausted: boolean }
type Result = {
  provider: Provider
  account?: string
  windows?: Window[]
  exhausted?: boolean
  error?: string
}

function window(seconds: unknown, used: unknown): Window {
  if (
    typeof seconds !== 'number' ||
    seconds <= 0 ||
    typeof used !== 'number' ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(used) ||
    used < 0 ||
    used > 100
  ) {
    throw new Error('Invalid quota window; priorities unchanged')
  }
  return { seconds, used }
}

// The provider endpoints and shapes follow ControlNet/cliproxyapi-quota-dashboard/src/providers.rs.
// CLIProxyAPI v7.3.10 /quota/fetch needs a plugin or probe, so use its documented /api-call instead (#14143).
export function quota(provider: Provider, usage: any): { windows: Window[]; exhausted: boolean } {
  const windows: Window[] = []
  if (provider === 'codex') {
    for (const value of [usage.rate_limit?.primary_window, usage.rate_limit?.secondary_window]) {
      if (value) windows.push(window(value.limit_window_seconds, value.used_percent))
    }
  } else {
    for (const [name, seconds] of [
      ['seven_day', 604800],
      ['five_hour', 18000],
    ] as const) {
      if (usage[name]) windows.push(window(seconds, usage[name].utilization))
    }
  }
  if (!windows.length) throw new Error('No quota windows; priorities unchanged')
  windows.sort((a, b) => b.seconds - a.seconds)
  return {
    windows,
    exhausted:
      windows.some((value) => value.used >= 100) ||
      (provider === 'codex' &&
        (usage.rate_limit.allowed === false || usage.rate_limit.limit_reached === true)),
  }
}

export function choose(accounts: Candidate[]): Candidate | undefined {
  return accounts
    .filter((account) => !account.exhausted)
    .sort((a, b) => {
      // Compare each plan's longest reported window, not raw tokens or equal-sized windows.
      // Free Codex can report 30 days while Pro reports 7 days (#14143).
      for (let i = 0; i < Math.max(a.windows.length, b.windows.length); i++) {
        const difference = (a.windows[i]?.used ?? 0) - (b.windows[i]?.used ?? 0)
        if (difference) return difference
      }
      // Keep the incumbent on equal use; otherwise use a stable runtime ID as the final tie-break.
      return (b.priority ?? 0) - (a.priority ?? 0) || a.auth_index.localeCompare(b.auth_index)
    })[0]
}

export async function pick(
  key: string,
  dryRun = false,
  fetcher: typeof fetch = fetch,
): Promise<Result[]> {
  if (!key) throw new Error('Add CLIPROXY_MANAGEMENT_KEY in Ultimate’s Secrets panel')
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetcher(`http://127.0.0.1:8317/v0/management/${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Management ${path}: HTTP ${response.status}`)
    return response.json()
  }
  const { files }: { files: Account[] } = await request('auth-files')
  const results: Result[] = []
  for (const provider of ['codex', 'claude'] as const) {
    const accounts = files.filter((account) => account.provider === provider && !account.disabled)
    if (!accounts.length) continue
    try {
      const candidates: Candidate[] = []
      for (const account of accounts) {
        const header: Record<string, string> = { Authorization: 'Bearer $TOKEN$' }
        if (provider === 'codex') {
          const id = account.id_token?.chatgpt_account_id
          if (!id) throw new Error('Missing Codex account ID; priorities unchanged')
          header['Chatgpt-Account-Id'] = id
        } else {
          header['anthropic-beta'] = 'oauth-2025-04-20'
        }
        const response = await request('api-call', 'POST', {
          auth_index: account.auth_index,
          method: 'GET',
          header,
          url:
            provider === 'codex'
              ? 'https://chatgpt.com/backend-api/wham/usage'
              : 'https://api.anthropic.com/api/oauth/usage',
        })
        if (response.status_code !== 200)
          throw new Error(`Upstream quota: HTTP ${response.status_code}; priorities unchanged`)
        let usage
        try {
          usage = JSON.parse(response.body)
        } catch {
          // Never echo upstream response bodies: they can contain identifying or credential information.
          throw new Error('Invalid quota JSON; priorities unchanged')
        }
        candidates.push({ ...account, ...quota(provider, usage) })
      }
      const selected = choose(candidates)
      if (!selected) {
        results.push({ provider, exhausted: true })
        continue
      }
      if (!dryRun) {
        // Promote first, then demote the old pick. All credentials remain enabled for native failover.
        for (const account of [
          selected,
          ...accounts.filter((account) => account.auth_index !== selected.auth_index),
        ]) {
          const priority = account.auth_index === selected.auth_index ? 10 : 0
          if ((account.priority ?? 0) !== priority) {
            await request('auth-files/fields', 'PATCH', { name: account.name, priority })
          }
        }
        const current: { files: Account[] } = await request('auth-files')
        for (const account of accounts) {
          const actual = current.files.find((value) => value.auth_index === account.auth_index)
          const expected = account.auth_index === selected.auth_index ? 10 : 0
          if (!actual || actual.disabled || (actual.priority ?? 0) !== expected) {
            throw new Error('Priority readback failed; selection may be partially applied')
          }
        }
      }
      results.push({ provider, account: selected.auth_index, windows: selected.windows })
    } catch (error) {
      results.push({
        provider,
        error: error instanceof Error ? error.message : 'Account selection failed',
      })
    }
  }
  if (!dryRun && results.some((result) => result.account)) {
    await request('routing/strategy', 'PATCH', { value: 'fill-first' })
    const routing = await request('routing/strategy')
    if (routing.strategy !== 'fill-first') throw new Error('Routing readback failed')
  }
  return results
}

if (import.meta.main) {
  try {
    const results = await pick(
      process.env.CLIPROXY_MANAGEMENT_KEY ?? '',
      process.argv.includes('--dry-run'),
    )
    console.log(JSON.stringify(results))
    if (results.some((result) => result.error || result.exhausted)) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Account selection failed')
    process.exitCode = 1
  }
}
