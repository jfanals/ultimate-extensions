# CLIProxyAPI

Picks the least-used Codex and Claude account once a day through a local CLIProxyAPI service, keeping other accounts enabled for failover.

## Requirements

- Ultimate with its built-in Secrets and Automations extensions; Node 26.
- CLIProxyAPI on `http://127.0.0.1:8317`, with Codex or Claude OAuth accounts.
- Tested against CLIProxyAPI 7.3.10. The provider usage endpoints are not public contracts and may change.

## Install

Link this folder into `~/.ultimate/extensions/cliproxy`. Open **⌘K → Secrets**, find
`CLIPROXY_MANAGEMENT_KEY`, choose **Add**, paste a long random value and save. Do not send the value in chat.
Configure the proxy with the same management key, keeping `allow-remote: false`; CLIProxyAPI hashes the key
when it loads its config. Restrict the config file to the service user (`chmod 600`). The management key can
read credentials and make upstream calls, so treat it like a password.

Linking the extension declares the key and provides a manual `cliproxy.pick` action; it does not start a job.
Ask Ultimate to create a **recurring user-scope script automation**, with `CLIPROXY_MANAGEMENT_KEY` in its
`secrets`, which calls the exported `pick` function from this folder's `picker.ts` at **05:00 system-local time**.
The script should persist the last attempted due date, catch up after a missed run when Ultimate starts or the
Mac wakes, and notify `@ultimate` only on failure or exhausted accounts. Ultimate must be running for the job.
The automation's script receives the key in its environment; it must not read or log the secrets file.

## Selection and failover

- Usage comes from the provider via management `/api-call`: Codex `backend-api/wham/usage`, Claude `api/oauth/usage`.
  This includes use outside the proxy. No token telemetry or historical collector is required.
- Each provider is selected separately. Compare the **percentage used in each plan's longest reported window**,
  then shorter windows on a tie. These are not necessarily the same duration: free Codex can report 30 days while
  Pro reports 7 days. Null inactive windows are omitted, not treated as failed reads.
- Prefer the previous pick on an exact tie, then the stable credential index. Disabled accounts are ignored.
  Accounts with a full general quota window or a Codex denied/limit-reached signal are not picked.
- Set the pick's numeric priority to `10`, the others to `0`, and use `fill-first` with session affinity off.
  All backups remain enabled. The proxy's own cooldown and failover handle mid-day exhaustion; the preferred
  account can be used again when its cooldown clears. This is a daily preference, not a hard account lock.
- Read back priorities and routing after writing. A failed quota read leaves that provider's priorities unchanged;
  a failed write can be partially applied and is reported. No eligible accounts leaves the previous order unchanged
  and reports exhaustion. A failure in one provider does not stop the other provider's selection.
- Claude model-specific limits are not the general account score. The proxy handles model-specific failures.
  The picker cannot create quota when all accounts are exhausted: requests can fail until a limit resets.

## Manual checks

Through Ultimate's extension actions, `cliproxy.pick` with `{ "dryRun": true }` checks quotas without changing
anything; with `null` it applies a manual pick. Results contain credential indexes and usage percentages, not keys,
email addresses or auth-file contents. The manual action reads the key with Ultimate's `lib/secrets.ts` helper.

The standalone helper takes the key only from `CLIPROXY_MANAGEMENT_KEY`:

```sh
node /path/to/ultimate-extensions/cliproxy/picker.ts --dry-run
```

A standalone run prints sanitized JSON and exits nonzero on failure or exhausted accounts. A manual pick is an
explicit extra run; it does not update the separate automation's last-attempt date.

## Risks

Provider subscription/OAuth terms may restrict third-party clients and pooling; account access may be revoked.
Using this extension does not establish permission from either provider. Do not enable paid overages to work
around exhaustion. A daily preference preserves caching better than per-request rotation but does not guarantee
cache hits or prevent switching when the proxy fails over. The management API's `/quota/fetch` is a plugin/probe
mechanism in 7.3.10, not a built-in Claude/Codex quota adapter.

## Settings, update and uninstall

No extension settings or extra packages. Pull this repository to update. Remove the
`~/.ultimate/extensions/cliproxy` link to uninstall. Pause/delete its separate automation too. Neither action deletes
the saved key or restores proxy priorities/routing. To undo routing, set credentials' priorities back to `0` and
restore the proxy's previous strategy (`round-robin` by default). Leave management enabled only if still needed.

## Tests

```sh
node --test cliproxy/picker.test.ts
```

Core selection, backup preservation, dry runs and failed quota reads use a fake management server (no processes or
network). Secret entry uses Ultimate's existing Secrets panel, with no custom renderer.
