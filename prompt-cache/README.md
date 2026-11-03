# Prompt cache

Shows when a conversation's prompt cache was rebuilt, so you see when the provider billed the whole context again,
and when keep-warm renewed @ultimate's cache. After Pi's cache-miss notices.

## Requirements

None beyond Ultimate: it uses Pi's `collectCacheMisses` from the Ultimate clone's `node_modules`.

## In the transcript

- **Amber** `⟳ Cache rebuilt after 4h 45m idle · 174k tokens · $1.35`: the reply below wrote that many tokens to the
  cache again instead of reading them; the cost is what that reply paid over a cache hit. "after model switch" when the
  model changed, no cause when the gap was under 5 minutes (a changed prompt). It sits after the input that started the
  reply, or above the reply when no input row did (a reply after a compaction, a tool result). Pi's threshold: only
  misses of 20k tokens or $0.10 and up show.
- **Grey** `cache warmed · $0.05` (or `cache warmed 3× · $0.15`): keep-warm pings after that @ultimate reply.
- **Red** `cache warm failed · <reason>`: a ping failed; keep-warm sends no more until @ultimate's next answer.

Every conversation shows its misses, branches and subagents included. Warm lines show only in @ultimate's
conversation, the one keep-warm pings.

## Status line

The `cache` chip next to `warm`: amber after a miss in the last 24 hours, red after a failed ping. Its popover shows
the last miss (when, cost, conversation), this week's misses and pings, with their totals.

## Settings

In `~/.ultimate/settings.json`, read at each call:

```json
{ "cache": { "showMisses": true, "showWarms": true } }
```

Both default to `true`; `false` hides the amber lines or the grey and red ones. The chip stays.

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
- Actions: `notes { conversation }` → its shown misses and pings with the settings; `summary` → the newest miss,
  this week's misses and pings. Counts are cached per conversation until its newest entry changes.
- The transcript wraps the input kinds (`pi.user`, `drive.spoken`, `board.message`, `board.reply`,
  `subagents.instruction`, `subagents.report`, `workspaces.lander-report`) and `pi.assistant` with entry renderers,
  as `models` marks a model switch; nothing in the clone changes.

Other extensions are named by string (`keep-warm.state`, `ultimate.standing-agents`, the entry kinds above). If an
Ultimate update renames one, check them against the built-ins.

## Tests

The test loads Pi from your Ultimate clone, so point `ULTIMATE_ROOT` at it:

```sh
cd ~/ultimate-extensions && ULTIMATE_ROOT=/path/to/ultimate node --test prompt-cache/cache.test.ts
```
