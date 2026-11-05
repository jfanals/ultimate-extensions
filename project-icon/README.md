# Project icon

Gives each project its own tile, two initials on a colour picked from the project's name, so several Ultimate tabs
or app windows can be told apart at a glance. [tab-status](../tab-status/) draws it as the browser tab's favicon (with
its status dot) and [projects](../projects/) shows it on each row of the Projects tab.

## Requirements

None beyond Ultimate. On its own it shows nothing: install tab-status, projects or both.

## What it draws

- **Initials** from the project's folder name: the first letters of its first two words, split on `-`, `_`, `.`,
  spaces and camelCase (`my-app` → `MA`, `RecipeBook` → `RB`). A one-word name gives its first letter and its second
  in lower case (`notes` → `No`). A branch checkout under `~/.ultimate/projects/` uses its project's name.
- **Colour:** one of ten well-separated hues, chosen by an FNV-1a hash of the name, so the same name gets the same
  colour on every machine.
- **Ink:** white or near-black, whichever has the higher WCAG contrast ratio with the background.
- **Status dot:** tab-status puts its dot (amber needs you, violet working, green new answer, red failed) in the
  top-right corner, in a notch cut out of the tile, so the second letter stays readable at 16 px.

## Settings

`projectIcon` in `~/.ultimate/settings.json`, keyed by project name (the folder name). Both fields are optional:

```json
{ "projectIcon": { "my-app": { "color": "#e8a33d", "text": "Ma" } } }
```

- `color`: a `#rgb` or `#rrggbb` background, for two projects that came out alike. The ink is still chosen for it.
  Anything else is ignored.
- `text`: the letters to show instead of the initials (one to three fit).

Open pages read the setting again every minute.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/project-icon ~/.ultimate/extensions/project-icon      # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/project-icon                                            # uninstall
```

Ultimate picks up each change live; no restart. tab-status and projects import `icon.ts` and `use-overrides.ts`
from this folder, so keep it in the clone while either is installed. Without its link the tiles still show, in the
colours from their names, but the setting is not read.

## How it works

`icon.ts` holds the pure functions: `initials(name)`, `colours(name, override?)`, `tile(name, { dot?, override? })`
(an SVG data URL), `projectName(root)` and `overrides(value)`, which keeps the setting's valid entries. `server.ts` has
one read-only action, `overrides`, that reads the setting; `use-overrides.ts` shares one read of it per page, refreshed
every minute.

## Tests

```sh
cd ~/ultimate-extensions && node --test project-icon/icon.test.ts
```
