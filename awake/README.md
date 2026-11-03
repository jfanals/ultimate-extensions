# Awake

Keeps the Mac from sleeping while agents work, and lets it sleep again once they are done.

## Requirements

- macOS (it uses `caffeinate` and `pmset`). On other systems it loads and does nothing.

## What it does

- While any conversation in this project is busy (branches, subagents, the lander, @ultimate), the server holds one
  `caffeinate -s -w <server pid>`. `-s` prevents system sleep **on AC power only**: on battery macOS ignores it, so
  the Mac sleeps as usual. The display still sleeps.
- About 2 minutes after the last agent goes idle, the hold is released. It also ends at once when the facet unloads or
  reinstalls, and with the server (`-w`). Never more than one per server; each Ultimate (one per project) holds its own.
- The status line shows a quiet `awake` while the hold is on and the Mac is on AC; hover says why
  ("Keeping the Mac awake: 2 agents working"). Hidden otherwise.

**Limit:** closing the lid still sleeps the Mac, unless an external display is attached (clamshell mode).

## Settings

None.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/awake ~/.ultimate/extensions/awake                    # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/awake                                                   # uninstall
```

Ultimate picks up each change live; no restart.

## How it works

`awake.ts` is the hold and release rule (no timers, no processes). `server.ts` feeds it the busy count from
`host.conversations()` every 5 s and reads `pmset -g batt` every 60 s; the `state` action serves the chip in `web.tsx`.

Check it: `pmset -g assertions | grep caffeinate` shows `PreventSystemSleep` while held; `pgrep -fl caffeinate`.

## Tests

```sh
cd ~/ultimate-extensions && node --test awake/awake.test.ts
```
