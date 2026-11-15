# Dream defaults

Your own thresholds for Ultimate's two built-in dream automations, "Dream before compaction" and "Dream after a
pause", in every project, new ones included. Upstream makes them at 70% and 50% of @ultimate's context.

## Requirements

- Ultimate with its dream and automations extensions (built in).

## What it does

Once per chapter, when dream has made its built-ins (as a project opens, or once @ultimate starts on a fresh project),
each one still at upstream's threshold gets yours. It changes only `above`; the pause of "Dream after a pause" stays.

It never overrides you:

- An automation you edited (any threshold but upstream's), paused or deleted is left alone.
- Each built-in is handled once per chapter: setting one back to 70% later in the chapter keeps it at 70%.
- A chapter whose seed carries a built-in's condition keeps that condition (see below).

What it set or left is recorded in `dream-defaults.json` in the chapter's folder (the project's home for the first
chapter, `chapters/<name>/` after a Fall asleep).

## With dream's own seed

A new chapter (after Fall asleep) makes the built-ins again from its seed. Until Ultimate's dream carries each
built-in's condition in that seed, an edited threshold resets to 70% and 50% there, and this extension puts yours
back. Once dream carries the condition, a new chapter keeps whatever you had, and this extension stands aside for any
seed that has one. It is still what gives a brand-new project your thresholds: there is no seed to carry them from.

## Settings

`dreamDefaults` in `~/.ultimate/settings.json`, whole percentages from 1 to 99; leave one out to keep upstream's:

```json
"dreamDefaults": { "beforeCompaction": 22, "afterPause": 20 }
```

Without the setting it does nothing. A changed setting applies from each project's next chapter, or to a fresh
project; change a running one in the Automations panel.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/dream-defaults ~/.ultimate/extensions/dream-defaults  # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/dream-defaults                                          # uninstall
```

Ultimate picks up each change live; no restart. Uninstalling leaves the automations as they are.

## How it works

`defaults.ts` is the rule: wait while dream has not made a built-in (found by the key dream creates it with), set
yours only on an enabled one still at upstream's threshold whose seed carried no condition, otherwise leave it.
`server.ts` checks at each opening and on each commit to dream's documents that record the built-ins' ids, through the
automations `list` and `update` actions, and stops watching once both are handled.

## Tests

```sh
cd ~/ultimate-extensions && node --test dream-defaults/defaults.test.ts
```
