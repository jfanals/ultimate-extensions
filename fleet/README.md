# Fleet

Every Ultimate project on this machine at a glance, from any of them, with a counter of what waits on you across all
of them. It sits beside Ultimate's built-in **projects** rail (the tiles at the window's left edge); the different
name keeps this user extension from shadowing it.

## Requirements

- **tab-status**, from this repository: fleet imports its `status.ts` (`../tab-status/status.ts`), so the
  tab-status folder must sit next to it, as it does in the clone. Install both.
- **project-icon**, from this repository: each row shows its project's tile (`../project-icon/`), with the
  `projectIcon` overrides applied.
- Ultimate's built-in **inbox** and **messages** extensions: the other projects' questions join this project's Inbox
  through the Inbox's `InboxItems` point, drawn with its `lead` and messages' `Body` (imported from the clone,
  `@/../../extensions/inbox/` and `@/../../extensions/messages/ui.tsx`).
- Optional: Ultimate's built-in tailscale extension, for links that open over the tailnet.

## Using it

- **The counter** in the status line, `◆ 3 waiting in 2 projects`, counts the messages waiting on your answer in every
  project; amber while any waits, a quiet grey `◆ 0` when none does. On a phone it stays on the line as `◆ 3 waiting`.
  Click it to open Fleet.
- **The Inbox lists every project's questions.** Each question waiting in another running project is an item in this
  project's Inbox, tagged with that project's name, so the Inbox row and the To-dos' "For you" count everything that
  waits on you. Its reading pane shows the whole message, its questions with their picks (read-only), how many images
  came with it, and **Answer in <project>**, which opens that project's Inbox at the question. The item leaves once the
  question is answered or dismissed there, by the next poll (30 s). The item's key is `fleet:<name>:<message>`, so
  `?inbox=fleet:my-app:12` opens one. Images and links to the other project's files show only there.
- **Fleet** (a surface, `mod+1…9` or ⌘K **Open Fleet**) lists each project with its tile, folder and status, the
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

- **The whole row opens it.** Click or tap anywhere on a row: a running project opens in the same window, the
  **this window** row opens this project's @ultimate, a stopped one starts and opens once it answers, a starting one
  opens once it answers (the status adds `opens when ready`). A row with `n waiting` opens this window's Inbox at that
  project's oldest question instead, without leaving. The row is one button, so Tab reaches it and Enter opens it. That
  project's own counter and Fleet tab bring you back. Over the tailnet (HTTPS) links use each project's tailnet
  port, else its loopback port.
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
  - **Open folder** lists the folders in the fleet roots that are not projects yet, most recent first (git
    activity, else the folder's own), with a filter; **Start** starts Ultimate there.
  - **New project** takes a name and one of the roots, creates the folder, runs `git init` with an empty first commit
    (skipped without a git identity; Ultimate's setup offers it then), and starts Ultimate there.

  Either way the new row shows `starting…` and the page opens the project once it answers, at its @ultimate with
  Ultimate's setup card.

## Settings

`fleet.roots` in `~/.ultimate/settings.json`: the folders Add project lists and creates in, `~/` for the home.

```json
{ "fleet": { "roots": ["~/code", "~/work"] } }
```

Without it, the roots are the folders that hold the projects already on the machine. Hidden projects are kept in
`~/.ultimate/fleet-hidden.json`.

## Safety

Start, Stop, Hide and Add project are user-only actions: agents cannot call them. Open accepts only an existing folder
that, after resolving symlinks and `..`, lies inside a root; New project only a plain name (letters, digits, `.`, `_`,
`-`, not starting with `.` or `-`) in one of the roots, and fails when the folder exists. Stop signals only a pid whose
command is `bin/ultimate.ts` for that project's root (or runs in it, under `pnpm start`), so a pid reused after a crash
is left alone. Stop and the folder listing use `ps` and `lsof` (macOS and Linux).

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/tab-status ~/.ultimate/extensions/tab-status          # install (needed by fleet)
ln -s ~/ultimate-extensions/project-icon ~/.ultimate/extensions/project-icon      # install (needed by fleet)
ln -s ~/ultimate-extensions/fleet ~/.ultimate/extensions/fleet                    # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/fleet                                                   # uninstall
```

Ultimate picks up each change live; no restart.

## How it works

Every Ultimate on the machine loads this user extension, so each answers `fleet/here`: its own status by
tab-status's rules (the same priority as the browser tab), its busy count, and the messages waiting on the user (the
`messages` service's `openQuestions()`), each with its whole text, its questions and its image count from the Messages
log (the `board` document). The instance the page is on answers `overview`: the projects registry
(`host.projects()`), each running instance's `here` over loopback with its own `Origin`, and the tailnet ports from
`~/.ultimate/tailscale.json`. The page polls `overview` every 30 s, every 3 s while a project starts or stops. `folders` lists the
roots on demand when Add project opens.

The questions of the other projects become Inbox items in the page (`InboxItems`), from that same poll. Nothing is
copied into this project: every project that runs this extension lists the others' questions the same way, and none
pushes them. Each project's own push extension, where it is on, notifies its own questions once. **Answer in
<project>** opens `?inbox=<message>` there, which the inbox extension turns into its surface at that item (and wins
over wherever the project was left). A row without a question opens with `#fleet-open`, so the target shows its
conversation even when it was last left on Fleet, which it usually was: that is how you got here.

"new answer" uses the `ext.conversations.seen` the user's last browser left in that project, so it can lag behind the
browser tab's own dot.

It imports packages, `@/sdk`, tab-status's `status.ts`, project-icon's tile, and the inbox's `InboxItems` and `lead` and
messages' `Body` from the clone; on the server other extensions are named by string (the `messages` service, the
`board` and `ultimate.conversation-overview` documents, `ext.conversations.*` UI state). If an Ultimate update renames
one, `here` fails and rows show `not answering`.

## Tests

```sh
cd ~/ultimate-extensions && node --test fleet/fleet.test.ts
```
