# Prompt cache

Shows when keep-warm renewed @ultimate's prompt cache, and what cache rebuilds and warms cost across conversations.

Ultimate itself marks each rebuild in the transcript (a "cache rebuilt" note on the turn, with its cause), so this
extension draws no line of its own for them; it adds the warms and the dollar totals.

## Requirements

None beyond Ultimate: it uses Pi's `collectCacheMisses` from the Ultimate clone's `node_modules`.

## In the transcript

- **Grey** `cache warmed · $0.05` (or `cache warmed 3× · $0.15`): keep-warm pings after that @ultimate reply.
- **Red** `cache warm failed · <reason>`: a ping failed; keep-warm sends no more until @ultimate's next answer.

Warm lines show only in @ultimate's conversation, the one keep-warm pings.

## Status line

The `cache` chip next to `warm`: amber after a rebuild (a cache miss) in the last 24 hours, red after a failed ping.
Its popover shows the last miss (when, cost, conversation), this week's misses and pings, with their totals. Every
conversation counts, branches and subagents included; Pi's threshold applies: only misses of 20k tokens or $0.10 and up.

## Settings

In `~/.ultimate/settings.json`, read at each call:

```json
{ "cache": { "showWarms": true } }
```

Defaults to `true`; `false` hides the grey and red lines. The chip stays. The former `showMisses` setting is gone with
the amber rebuild lines; an old value is ignored.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/prompt-cache ~/.ultimate/extensions/prompt-cache      # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/prompt-cache                                            # uninstall
```

Ultimate picks up each change live; no restart.

## How it works

- `misses.ts` turns a conversation's entries into the Pi session entries that Pi's own `collectCacheMisses`
  (`@earendil-works/pi-coding-agent/dist/core/cache-stats.js`, not in its public exports, so it is loaded by path from
  the clone's `node_modules`) reads: replies as messages, `pi.compaction`/`pi.reset` as compactions (the context
  changed, not a miss), keep-warm pings as `cache_warm` usage (they renew the cache, so idle time runs from them).
  Pi does the maths: missed tokens above its 1024-token noise floor, cost at the paid rate minus the read rate.
- keep-warm keeps only its last ping (`keep-warm.state` on conversation 1). A timer here copies each finished ping
  into `cache.warms` on conversation 1, priced from the model's rates (`calculateCost`, one-hour write), so warm lines
  start from installation; earlier pings were never stored.
- Actions: `warms { conversation }` → the pings on it; `summary` → the newest miss, this week's misses and pings.
  Counts are cached per conversation until its newest entry changes.
- The transcript wraps `pi.assistant` with an entry renderer, as `models` marks a model switch; nothing in the clone
  changes.

Other extensions are named by string (`keep-warm.state`, `ultimate.standing-agents`, `pi.assistant`). If an
Ultimate update renames one, check them against the built-ins.

## Tests

The test loads Pi from your Ultimate clone, so point `ULTIMATE_ROOT` at it:

```sh
cd ~/ultimate-extensions && ULTIMATE_ROOT=/path/to/ultimate node --test prompt-cache/cache.test.ts
```
