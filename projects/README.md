# Projects

Every Ultimate project on this machine at a glance, from any of them, with a counter of what waits on you across all
of them.

## Requirements

- **tab-status**, from this repository: projects imports its `status.ts` (`../tab-status/status.ts`), so the
  tab-status folder must sit next to it, as it does in the clone. Install both.
- **project-icon**, from this repository: each row shows its project's tile (`../project-icon/`), with the
  `projectIcon` overrides applied.
- Optional: Ultimate's built-in tailscale extension, for links that open over the tailnet.

## Using it

- **The counter** in the status line, `◆ 3 waiting in 2 projects`, counts the messages waiting on your answer in every
  project; amber while any waits, a quiet grey `◆ 0` when none does. On a phone it stays on the line as `◆ 3 waiting`.
  Click it to open Projects.
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
  | hollow          | `not answering`: running but did not answer in 5 s (hover it) |

  Below, every question waiting on you across projects, oldest first.

- **Open** goes to that project in the same window; a question opens it at the conversation that asked, scrolled to
  the question's card. That project's own counter and Projects tab bring you back. Over the tailnet (HTTPS) links use
  each project's tailnet port, else its loopback port.
- **Start** runs the current Ultimate clone's `bin/ultimate.ts <root> --no-open` on the same Node, detached, without
  this instance's `ULTIMATE_*` variables, logging to `~/.ultimate/logs/<name>.log`.

## Settings

None.

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
`~/.ultimate/tailscale.json`. The page polls `overview` every 30 s, every 3 s while a project starts. `start` is a
user-only action.

The target of **Open** shows its conversation even when it was last left on Projects (`#projects-open`, or
`#projects-open:<message>` for a question: it finds the asking response with messages' `caller` action and scrolls to
`[data-message-outgoing=<message>]`).

"new answer" uses the `ext.conversations.seen` the user's last browser left in that project, so it can lag behind the
browser tab's own dot.

It imports only packages, `@/sdk`, tab-status's `status.ts` and project-icon's tile; other extensions are named by string (the `messages`
service, the `ultimate.conversation-overview` document, `ext.conversations.*` UI state). If an Ultimate update renames
one, `here` fails and rows show `not answering`.

## Tests

```sh
cd ~/ultimate-extensions && node --test projects/projects.test.ts
```
