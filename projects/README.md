# Projects

Every Ultimate project on this machine at a glance, from any of them, with a counter of what waits on you across all
of them.

## Requirements

- **tab-status**, from this repository: projects imports its `status.ts` (`../tab-status/status.ts`), so the
  tab-status folder must sit next to it, as it does in the clone. Install both.
- **project-icon**, from this repository: each row shows its project's tile (`../project-icon/`), with the
  `projectIcon` overrides applied.
- Ultimate's built-in **inbox** extension: every question opens in its project's Inbox (`?inbox=<message>`), and the
  sidebar row comes from the sidebar's `sidebar.under-ultimate` point (imported from the clone,
  `@/../../extensions/sidebar/ui.tsx`).
- Optional: Ultimate's built-in tailscale extension, for links that open over the tailnet.

## Using it

- **The counter** in the status line, `◆ 3 waiting in 2 projects`, counts the messages waiting on your answer in every
  project; amber while any waits, a quiet grey `◆ 0` when none does. On a phone it stays on the line as `◆ 3 waiting`.
  Click it to open Projects.
- **Elsewhere**, a sidebar row under the Inbox's, counts what waits on you in the _other_ projects (the Inbox row
  already counts this one): amber `Elsewhere · 3 in RevenueHunt, ha`, or `in 4 projects` past two. A click opens the
  oldest of them in its project's Inbox, ready to answer; the counter is one click away for the whole picture. With
  nothing waiting elsewhere the row is gone.
- **Projects** (a surface, `mod+1…9` or ⌘K **Open Projects**) lists each project with its tile, folder and status, the
  current one first and marked **this window**:

  | Dot             | Status                                                        |
  | --------------- | ------------------------------------------------------------- |
  | amber           | `n waiting`: a message waits on your answer                   |
  | red             | `failed`: a branch or standing agent's latest run failed      |
  | violet, pulsing | `working · n busy`                                            |
  | green           | `new answer` you have not seen                                |
  | hollow          | `idle`                                                        |
  | –               | `stopped`, with **Start**                                     |
  | spinner         | `starting…` after Start, until the project answers            |
  | spinner         | `stopping…` after Stop, until the project lets go             |
  | hollow          | `not answering`: running but did not answer in 5 s (hover it) |

  Below, every question waiting on you, grouped by project: the project waiting longest first, its questions oldest
  first, each opening that project's Inbox at it.

- **The whole row opens it.** Click or tap anywhere on a row: a running project opens in the same window, the
  **this window** row opens this project's @ultimate, a stopped one starts and opens once it answers, a starting one
  opens once it answers (the status adds `opens when ready`). A row with `n waiting` opens that project's Inbox at its
  oldest question instead. The row is one button, so Tab reaches it and Enter opens it. A question opens its project's
  Inbox at that item (`?inbox=<message>`); one in this project opens the Inbox in place, without a reload. That
  project's own counter and Projects tab bring you back. Over the tailnet (HTTPS) links use each project's tailnet port, else its
  loopback port.
- **Desktop and tablet:** the one other action sits in its own column at the right, outside the row's button: **Stop**
  on a running project, **Start** (start without opening) and **⋯** → **Hide** on a stopped one.
- **Phone:** swipe a row left to show **Stop** (running) or **Hide** (stopped); a tap elsewhere, Escape or a tap on
  the row closes it. A vertical drag scrolls the list as usual: the swipe only takes a drag that moves sideways first.
  A long press opens the same actions as a sheet, for anyone who cannot or does not swipe.
- **Start** runs the current Ultimate clone's `bin/ultimate.ts <root> --no-open` on the same Node, detached, without
  this instance's `ULTIMATE_*` variables, logging to `~/.ultimate/logs/<name>.log`.
- **Stop** shuts another running project down cleanly: its supervisor gets SIGTERM, releases its core and lock, and
  runs it interrupts resume on its next Start. A project with busy conversations asks first, with the count. The
  project this window is on has no Stop: stop it from another project's tab.
- **Hide** (on a stopped row) leaves a project out of the list; its folder and conversations stay, and it shows again
  while it runs. **show n hidden** below the list brings it back.
- **Add project** opens a panel with two tabs:
  - **Open folder** lists the folders in the projects roots that are not projects yet, most recent first (git
    activity, else the folder's own), with a filter; **Start** starts Ultimate there.
  - **New project** takes a name and one of the roots, creates the folder, runs `git init` with an empty first commit
    (skipped without a git identity; Ultimate's setup offers it then), and starts Ultimate there.

  Either way the new row shows `starting…` and the page opens the project once it answers, at its @ultimate with
  Ultimate's setup card.

## Settings

`projects.roots` in `~/.ultimate/settings.json`: the folders Add project lists and creates in, `~/` for the home.

```json
{ "projects": { "roots": ["~/code", "~/work"] } }
```

Without it, the roots are the folders that hold the projects already on the machine. Hidden projects are kept in
`~/.ultimate/projects-hidden.json`.

## Safety

Start, Stop, Hide and Add project are user-only actions: agents cannot call them. Open accepts only an existing folder
that, after resolving symlinks and `..`, lies inside a root; New project only a plain name (letters, digits, `.`, `_`,
`-`, not starting with `.` or `-`) in one of the roots, and fails when the folder exists. Stop signals only a pid whose
command is `bin/ultimate.ts` for that project's root (or runs in it, under `pnpm start`), so a pid reused after a crash
is left alone. Stop and the folder listing use `ps` and `lsof` (macOS and Linux).

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/tab-status ~/.ultimate/extensions/tab-status          # install (needed by projects)
ln -s ~/ultimate-extensions/project-icon ~/.ultimate/extensions/project-icon      # install (needed by projects)
ln -s ~/ultimate-extensions/projects ~/.ultimate/extensions/projects              # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/projects                                                # uninstall
```

Ultimate picks up each change live; no restart.

## How it works

Every Ultimate on the machine loads this user extension, so each answers `projects/here`: its own status by
tab-status's rules (the same priority as the browser tab), its busy count, and the messages waiting on the user (the
`messages` service's `openQuestions()`). The instance the page is on answers `overview`: the projects registry
(`host.projects()`), each running instance's `here` over loopback with its own `Origin`, and the tailnet ports from
`~/.ultimate/tailscale.json`. The page polls `overview` every 30 s, every 3 s while a project starts or stops. `folders` lists the
roots on demand when Add project opens.

A question opens as `?inbox=<message>`, which the inbox extension turns into its surface at that item (and wins over
wherever the project was left); this project's own questions use its `inbox:open {message}` event instead. A row
without a question opens with `#projects-open`, so the target shows its conversation even when it was last left on
Projects, which it usually was: that is how you got here.

"new answer" uses the `ext.conversations.seen` the user's last browser left in that project, so it can lag behind the
browser tab's own dot.

It imports only packages, `@/sdk`, tab-status's `status.ts` and project-icon's tile; other extensions are named by string (the `messages`
service, the `ultimate.conversation-overview` document, `ext.conversations.*` UI state). If an Ultimate update renames
one, `here` fails and rows show `not answering`.

## Tests

```sh
cd ~/ultimate-extensions && node --test projects/projects.test.ts
```
